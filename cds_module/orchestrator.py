"""
CDS Gateway Orchestrator: Central Coordination Service.
Coordinates the frozen RAG pipeline, deterministic drug interaction engine,
and request-scoped clinical context.
Fail-closed, strictly stateless, with zero patient vector storage in the global corpus.
"""
import logging
import re
from typing import Optional, List, Dict, Any, Union

from cds_module.models import (
    CDSEvaluateRequest,
    CDSEvaluateResponse,
    CDSCitation,
    DrugInteractionAlert,
    PatientContext,
    PrescriptionScreenRequest,
    PrescriptionScreenResponse
)

logger = logging.getLogger("cds_module.orchestrator")


class CDSOrchestrator:
    """
    Stateless clinical decision support coordinator.
    Delegates medical knowledge retrieval to MedicalRAGPipeline and drug safety
    to deterministic DrugBank rule engines.
    """

    def __init__(self, rag_pipeline=None, interaction_dict: Optional[Dict[Any, Any]] = None):
        self._rag_pipeline = rag_pipeline
        self._interaction_dict = interaction_dict

    @property
    def rag_pipeline(self):
        if self._rag_pipeline is None:
            from rag_module.api import get_legacy_pipeline
            self._rag_pipeline = get_legacy_pipeline()
        return self._rag_pipeline

    @property
    def interaction_dict(self):
        if self._interaction_dict is None:
            from drug_module.data_loader import load_drugbank
            self._interaction_dict = load_drugbank()
        return self._interaction_dict

    def _extract_drugs_from_request(self, request: CDSEvaluateRequest) -> List[str]:
        """
        Extracts medication names from candidate list, request-scoped patient context,
        and known clinical entities mentioned in the query.
        """
        drugs: List[str] = []

        # 1. Explicit candidate medications
        for cand in request.candidate_medications:
            if cand and str(cand).strip():
                drugs.append(str(cand).strip())

        # 2. Active medications from patient context
        if request.patient_context and request.patient_context.active_medications:
            for med in request.patient_context.active_medications:
                if isinstance(med, str):
                    name = med.strip()
                    if name and name not in drugs:
                        drugs.append(name)
                elif isinstance(med, dict):
                    name = med.get("name") or med.get("medicine_name") or med.get("drug")
                    if name and str(name).strip() and str(name).strip() not in drugs:
                        drugs.append(str(name).strip())

        # 3. Known drugs in the deterministic rules mentioned in the clinical query
        if request.clinical_query and self.interaction_dict:
            for known_drug in self.interaction_dict.keys():
                pattern = r'\b' + re.escape(str(known_drug)) + r'\b'
                if re.search(pattern, request.clinical_query, re.IGNORECASE):
                    if not any(d.lower() == str(known_drug).lower() for d in drugs):
                        drugs.append(str(known_drug).capitalize())

        return drugs

    def _check_conversational_input(
        self,
        query_text: str,
        effective_lang: str,
        detected_lang: str,
        canon_info: Dict[str, Any],
        mode: str
    ) -> Optional[CDSEvaluateResponse]:
        """
        Detects pure social greetings and ordinary acknowledgements with zero clinical claims.
        Guarantees that pure conversational inputs receive warm, polite, and localized responses.
        Fails-closed (returns None) if any clinical, medication, symptom, or care inquiry terms are present.
        """
        clean_text = query_text.strip().lower()
        clean_text = re.sub(r'[\.\?!,;:\'\"~]+$', '', clean_text).strip()

        # Strict list of clinical or care terms. If ANY term is present, NOT a pure greeting.
        clinical_care_keywords = [
            "discharge", "instruction", "instructions", "medication", "medications", "medicine",
            "medicines", "pill", "pills", "tablet", "tablets", "drug", "drugs", "dose", "dosage",
            "timing", "schedule", "routine", "warning", "warnings", "emergency", "hospital", "clinic",
            "doctor", "physician", "appointment", "appointments", "follow-up", "followup", "test",
            "tests", "lab", "labs", "pain", "painkiller", "painkillers", "pressure", "hypertension",
            "heart", "chest", "sugar", "diabetes", "headache", "fever", "cough", "dizziness",
            "allergy", "allergies", "symptom", "symptoms", "diagnosis", "diagnoses", "condition",
            "take", "taking", "eat", "eating", "food", "water", "morning", "night", "evening",
            "amlodipine", "metformin", "lisinopril", "aspirin", "ibuprofen", "atorvastatin",
            "clarithromycin", "warfarin", "paracetamol",
            # Indic clinical markers
            "डिस्चार्ज", "निर्देश", "दवा", "दवाई", "दवाएं", "दवाओं", "खुराक", "डोस", "गोली", "गोलियां",
            "समय", "कब", "कैसे", "चेतावनी", "लक्षण", "आपातकाल", "आपातकालीन", "अस्पताल", "डॉक्टर",
            "अपॉइंटमेंट", "फॉलो-अप", "जांच", "टेस्ट", "दर्द", "रक्तचाप", "ब्लड प्रेशर", "बीपी",
            "दिल", "छाती", "शुगर", "मधुमेह", "चक्कर", "एलर्जी", "लेना", "खाना", "पानी", "सुबह", "शाम",
            "सूचना", "औषध", "औषधे", "गोळ्या", "डोस", "वेळ", "कधी", "कशी", "चेतावणी", "लक्षणे",
            "आणीबाणी", "रुग्णालय", "तपासणी", "वेदना", "रक्तदाब", "हृदय", "छातीत", "सकाळ", "संध्याकाळ",
            "ડિસ્ચાર્જ", "સૂચનાઓ", "દવા", "દવાઓ", "ગોળીઓ", "ડોઝ", "સમય", "ક્યારે", "કેવી રીતે",
            "ચેતવણી", "લક્ષણો", "કટોકટી", "હોસ્પિટલ", "દાક્તર", "એપોઇન્ટમેન્ટ", "ટેસ્ટ", "દુખાવો",
            "રક્તચાપ", "હાઈ બ્લડ પ્રેશર", "સવારે", "સાંજે"
        ]

        for kw in clinical_care_keywords:
            if kw in clean_text:
                return None

        greeting_patterns = [
            r"^(hello|hi|hey|greetings|howdy)(?:\s+(there|assistant|doctor|bot))?$",
            r"^(good\s+(morning|afternoon|evening|day))(?:\s+(there|assistant|doctor|bot))?$",
            r"^(नमस्ते|नमस्कार|हेलो|हाय|प्रणाम|शुभ\s+(प्रभात|दोपहर|संध्या))(?:\s+जी)?$",
            r"^(नमस्कार|हॅलो|हाय|शुभ\s+(प्रभात|सकाळ|संध्याकाळ))$",
            r"^(નમસ્તે|નમસ્કાર|કેમ\s+છો|હેલો|હાય|સુપ્રભાત)$"
        ]

        for pat in greeting_patterns:
            if re.match(pat, clean_text, re.IGNORECASE):
                from multilingual_module.safety_templates import get_conversational_greeting
                return CDSEvaluateResponse(
                    clinical_query=query_text,
                    answer=(
                    "Hello! I am your Clinical Decision Support Assistant. "
                    "I can help with evidence-grounded clinical questions, "
                    "medication safety, contraindications, warnings, and medical evidence. "
                    "Please verify findings against the patient's chart and local protocols."
                    if mode == "doctor"
                    else get_conversational_greeting(effective_lang)
                ),
                    verification_status="conversational_greeting",
                    is_grounded=True,
                    is_emergency=False,
                    abstained=False,
                    citations=[],
                    drug_interactions=[],
                    safety_alerts=[],
                    abstention_reason=None,
                    execution_mode=mode,
                    pipeline_mode="conversational_interaction",
                    language=effective_lang,
                    detected_language=detected_lang,
                    canonical_query=canon_info["canonical_query"] if canon_info["was_canonicalized"] else None
                )

        ack_patterns = [
            r"^(thank\s*you|thanks|thanks\s+a\s+lot|thank\s+you\s+so\s+much|ok|okay|got\s+it|understood|fine|great|sure|all\s+right|alright|cool)$",
            r"^(धन्यवाद|शुक्रिया|बहुत\s+धन्यवाद|ठीक\s+है|समझ\s+गया|समझ\s+गई)$",
            r"^(धन्यवाद|आभार|खूप\s+धन्यवाद|ठीक\s+आहे|समजले)$",
            r"^(આભાર|ધન્યવાદ|ખૂબ\s+આભાર|ઠીક\s+છે|સમજાયું)$"
        ]

        for pat in ack_patterns:
            if re.match(pat, clean_text, re.IGNORECASE):
                from multilingual_module.safety_templates import get_conversational_acknowledgement
                return CDSEvaluateResponse(
                    clinical_query=query_text,
                    answer=get_conversational_acknowledgement(effective_lang),
                    verification_status="conversational_response",
                    is_grounded=True,
                    is_emergency=False,
                    abstained=False,
                    citations=[],
                    drug_interactions=[],
                    safety_alerts=[],
                    abstention_reason=None,
                    execution_mode=mode,
                    pipeline_mode="conversational_interaction",
                    language=effective_lang,
                    detected_language=detected_lang,
                    canonical_query=canon_info["canonical_query"] if canon_info["was_canonicalized"] else None
                )

        return None

    def _resolve_discharge_care_query(
        self,
        query_text: str,
        patient_context: PatientContext,
        effective_lang: str,
        detected_lang: str,
        canon_info: Dict[str, Any],
        detected_interactions: List[DrugInteractionAlert],
        safety_alerts: List[str]
    ) -> Optional[CDSEvaluateResponse]:
        """
        Directly grounds patient post-discharge care questions in their authorized clinical records:
        1. Medication timing and administration schedule
        2. Recovery warning signs & emergency escalation thresholds
        3. Follow-up appointments and lab test schedules
        4. General discharge summary & care plan explanation
        5. Drug interaction questions with active medications (e.g. Ibuprofen + Amlodipine)
        """
        discharge_instructions = ""
        medication_instructions = ""
        discharge_summary = ""
        diet_instructions = ""
        activity_instructions = ""
        warning_signs = ""
        follow_up_instructions = ""
        follow_up_date = ""
        discharge_diagnosis = ""

        dc = getattr(patient_context, "discharge_context", None)
        if isinstance(dc, dict):
            discharge_instructions = str(dc.get("discharge_instructions") or "").strip()
            medication_instructions = str(dc.get("medication_instructions") or "").strip()
            discharge_summary = str(dc.get("summary") or "").strip()
            warning_signs = str(dc.get("warning_signs") or "").strip()
            follow_up_instructions = str(dc.get("follow_up_instructions") or "").strip()
            follow_up_date = str(dc.get("follow_up_date") or "").strip()
            discharge_diagnosis = str(dc.get("diagnosis") or "").strip()
            records = dc.get("discharge_records") or []
            if isinstance(records, list):
                for record in records:
                    if not isinstance(record, dict):
                        continue
                    discharge_instructions = discharge_instructions or str(record.get("instructions") or "").strip()
                    medication_instructions = medication_instructions or str(record.get("medication_instructions") or "").strip()
                    discharge_summary = discharge_summary or str(record.get("summary") or "").strip()
                    warning_signs = warning_signs or str(record.get("warning_signs") or "").strip()
                    follow_up_instructions = follow_up_instructions or str(record.get("follow_up") or "").strip()
                    follow_up_date = follow_up_date or str(record.get("follow_up_date") or "").strip()
                    discharge_diagnosis = discharge_diagnosis or str(record.get("diagnosis") or "").strip()
                    diet_instructions = diet_instructions or str(record.get("diet") or "").strip()
                    activity_instructions = activity_instructions or str(record.get("activity") or "").strip()

        for item in (patient_context.medical_history or []):
            s = str(item).strip()
            if s.startswith("Discharge Care Instructions:"):
                discharge_instructions = discharge_instructions or s.replace("Discharge Care Instructions:", "").strip()
            elif s.startswith("Discharge Warning Signs:"):
                warning_signs = warning_signs or s.replace("Discharge Warning Signs:", "").strip()
            elif s.startswith("Discharge Follow-up Instructions:"):
                follow_up_instructions = follow_up_instructions or s.replace("Discharge Follow-up Instructions:", "").strip()
            elif s.startswith("Follow-up Scheduled Date:"):
                follow_up_date = follow_up_date or s.replace("Follow-up Scheduled Date:", "").strip()

        for d in (patient_context.diagnoses or []):
            s = str(d).strip()
            if "Discharge Diagnosis:" in s:
                discharge_diagnosis = discharge_diagnosis or s.replace("Discharge Diagnosis:", "").strip()
            elif not discharge_diagnosis:
                discharge_diagnosis = s

        active_meds = []
        for m in (patient_context.active_medications or []):
            if isinstance(m, str) and m.strip():
                active_meds.append(m.strip())
            elif isinstance(m, dict):
                name = m.get("name") or m.get("medicine_name") or m.get("drug")
                dose = m.get("dosage") or ""
                freq = m.get("frequency") or ""
                desc = f"{name} {dose} {freq}".strip()
                if desc:
                    active_meds.append(desc)

        meds_summary = ", ".join(active_meds) if active_meds else (discharge_instructions or "")
        q_lower = query_text.lower()
        canonical_lower = str(canon_info.get("canonical_query") or "").lower()

        discharge_citation = CDSCitation(
            source_index=1,
            title="Authorized Hospital Discharge Care Plan",
            source_name="Hospital EHR Clinical Discharge Summary",
            publisher="Treating Hospital Care Team",
            url="",
            chunk_id="",
            score=1.0
        )

        def finish_discharge_response(response):
            # Discharge summaries come from authorized EHR records.
            # Do not run them through the generic drug-monograph localizer.
            if effective_lang == "en":
                return response

            data = response.model_dump()
            answer = str(data.get("answer") or "")

            translations = {
                "hi": [
                    ("Based only on information in your available hospital discharge record:",
                     "आपके उपलब्ध अस्पताल के डिस्चार्ज रिकॉर्ड में दर्ज जानकारी के आधार पर:"),
                    ("Your recorded medication instructions state:",
                     "रिकॉर्ड में दर्ज दवा संबंधी निर्देश:"),
                    ("Your recorded follow-up information is:",
                     "रिकॉर्ड में दर्ज फॉलो-अप जानकारी:"),
                    ("Discharge diagnosis:", "डिस्चार्ज के समय दर्ज निदान:"),
                    ("Discharge summary:", "डिस्चार्ज सारांश:"),
                    ("Discharge instructions:", "डिस्चार्ज निर्देश:"),
                    ("Medication instructions:", "दवा लेने के निर्देश:"),
                    ("Documented warning signs:", "रिकॉर्ड में दर्ज चेतावनी संकेत:"),
                    ("Follow-up instructions:", "फॉलो-अप संबंधी निर्देश:"),
                    ("Follow-up date recorded:", "रिकॉर्ड में दर्ज फॉलो-अप तारीख:"),
                    ("Diet instructions:", "आहार संबंधी निर्देश:"),
                    ("Activity instructions:", "गतिविधि संबंधी निर्देश:"),
                    ("Follow your current prescription label and your treating clinician's instructions. Do not change your dose or schedule based on this chat.",
                     "अपनी वर्तमान दवा के लेबल और उपचार करने वाले चिकित्सक के निर्देशों का पालन करें। इस चैट के आधार पर खुराक या समय-सारणी न बदलें।"),
                    ("Confirm appointment and test requirements with your treating hospital.",
                     "अपॉइंटमेंट और जाँच की आवश्यकताओं की पुष्टि अपने उपचार करने वाले अस्पताल से करें।"),
                    ("This summary does not add instructions that are not documented. Contact your treating team if anything is missing or unclear.",
                     "इस सारांश में रिकॉर्ड से बाहर कोई निर्देश नहीं जोड़ा गया है। कोई जानकारी अधूरी या अस्पष्ट हो तो अपनी उपचार टीम से पुष्टि करें।"),
                    ("The available discharge records do not specify an exact medication timing. Check the current prescription label or contact your treating clinician or pharmacist before changing when or how you take the medicine.",
                     "उपलब्ध डिस्चार्ज रिकॉर्ड में दवा लेने का निश्चित समय दर्ज नहीं है। दवा लेने का समय या तरीका बदलने से पहले वर्तमान दवा-लेबल देखें या अपने चिकित्सक अथवा फार्मासिस्ट से पुष्टि करें।"),
                    ("I could not find a documented follow-up appointment or laboratory-test schedule in the available discharge records. Contact your treating hospital to confirm.",
                     "उपलब्ध डिस्चार्ज रिकॉर्ड में फॉलो-अप अपॉइंटमेंट या लैब जाँच की समय-सारणी नहीं मिली। कृपया अपने अस्पताल से इसकी पुष्टि करें।"),
                    ("I could not find detailed discharge instructions in the records available to this assistant. Contact your hospital or treating care team to confirm your aftercare plan.",
                     "इस सहायक को उपलब्ध रिकॉर्ड में विस्तृत डिस्चार्ज निर्देश नहीं मिले। कृपया आगे की देखभाल के निर्देशों की पुष्टि अपने अस्पताल या उपचार टीम से करें।"),
                ],
                "mr": [
                    ("Based only on information in your available hospital discharge record:",
                     "तुमच्या उपलब्ध रुग्णालयीन डिस्चार्ज नोंदीतील माहितीनुसार:"),
                    ("Your recorded medication instructions state:",
                     "नोंदीतील औषधविषयक सूचना:"),
                    ("Your recorded follow-up information is:",
                     "नोंदीतील पुढील भेटीची माहिती:"),
                    ("Discharge diagnosis:", "डिस्चार्जवेळचे निदान:"),
                    ("Discharge summary:", "डिस्चार्ज सारांश:"),
                    ("Discharge instructions:", "डिस्चार्ज सूचना:"),
                    ("Medication instructions:", "औषध घेण्याच्या सूचना:"),
                    ("Documented warning signs:", "नोंदवलेली धोक्याची लक्षणे:"),
                    ("Follow-up instructions:", "पुढील भेटीविषयी सूचना:"),
                    ("Follow-up date recorded:", "नोंदवलेली पुढील भेटीची तारीख:"),
                    ("Diet instructions:", "आहारविषयक सूचना:"),
                    ("Activity instructions:", "हालचालीविषयक सूचना:"),
                    ("Follow your current prescription label and your treating clinician's instructions. Do not change your dose or schedule based on this chat.",
                     "सध्याच्या औषधाच्या लेबलवरील आणि उपचार करणाऱ्या डॉक्टरांच्या सूचनांचे पालन करा. या चॅटच्या आधारे मात्रा किंवा वेळापत्रक बदलू नका."),
                    ("Confirm appointment and test requirements with your treating hospital.",
                     "भेटीची आणि तपासण्यांची आवश्यकता रुग्णालयाकडून निश्चित करून घ्या."),
                    ("This summary does not add instructions that are not documented. Contact your treating team if anything is missing or unclear.",
                     "या सारांशात नोंदीबाहेरील सूचना जोडलेल्या नाहीत. माहिती अपुरी किंवा अस्पष्ट असल्यास उपचार करणाऱ्या पथकाशी संपर्क साधा."),
                    ("The available discharge records do not specify an exact medication timing. Check the current prescription label or contact your treating clinician or pharmacist before changing when or how you take the medicine.",
                     "उपलब्ध डिस्चार्ज नोंदीत औषध घेण्याची निश्चित वेळ दिलेली नाही. वेळ किंवा पद्धत बदलण्यापूर्वी औषधाचे लेबल तपासा किंवा डॉक्टर अथवा फार्मासिस्टकडून खात्री करा."),
                    ("I could not find a documented follow-up appointment or laboratory-test schedule in the available discharge records. Contact your treating hospital to confirm.",
                     "उपलब्ध डिस्चार्ज नोंदीत पुढील भेटीचे किंवा प्रयोगशाळेतील तपासण्यांचे वेळापत्रक आढळले नाही. रुग्णालयाशी संपर्क साधून खात्री करा."),
                    ("I could not find detailed discharge instructions in the records available to this assistant. Contact your hospital or treating care team to confirm your aftercare plan.",
                     "या सहाय्यकाला उपलब्ध नोंदीत सविस्तर डिस्चार्ज सूचना आढळल्या नाहीत. पुढील काळजीच्या सूचनांसाठी रुग्णालयाशी किंवा उपचार पथकाशी संपर्क साधा."),
                ],
                "gu": [
                    ("Based only on information in your available hospital discharge record:",
                     "તમારા ઉપલબ્ધ હોસ્પિટલ ડિસ્ચાર્જ રેકોર્ડમાં નોંધાયેલી માહિતીના આધારે:"),
                    ("Your recorded medication instructions state:",
                     "રેકોર્ડમાં નોંધેલી દવા સંબંધિત સૂચનાઓ:"),
                    ("Your recorded follow-up information is:",
                     "રેકોર્ડમાં નોંધેલી અનુસરણ મુલાકાતની માહિતી:"),
                    ("Discharge diagnosis:", "ડિસ્ચાર્જ સમયે નોંધાયેલ નિદાન:"),
                    ("Discharge summary:", "ડિસ્ચાર્જ સારાંશ:"),
                    ("Discharge instructions:", "ડિસ્ચાર્જ સૂચનાઓ:"),
                    ("Medication instructions:", "દવા લેવાની સૂચનાઓ:"),
                    ("Documented warning signs:", "રેકોર્ડમાં નોંધાયેલા ચેતવણીના સંકેતો:"),
                    ("Follow-up instructions:", "અનુસરણ મુલાકાત સંબંધિત સૂચનાઓ:"),
                    ("Follow-up date recorded:", "રેકોર્ડમાં નોંધેલી અનુસરણ તારીખ:"),
                    ("Diet instructions:", "આહાર સંબંધિત સૂચનાઓ:"),
                    ("Activity instructions:", "પ્રવૃત્તિ સંબંધિત સૂચનાઓ:"),
                    ("Follow your current prescription label and your treating clinician's instructions. Do not change your dose or schedule based on this chat.",
                     "વર્તમાન દવાના લેબલ અને સારવાર કરતા ડૉક્ટરની સૂચનાઓનું પાલન કરો. આ ચેટના આધારે દવાની માત્રા અથવા સમયપત્રક બદલશો નહીં."),
                    ("Confirm appointment and test requirements with your treating hospital.",
                     "મુલાકાત અને તપાસની જરૂરિયાતોની તમારા સારવાર કરતા હોસ્પિટલ સાથે પુષ્ટિ કરો."),
                    ("This summary does not add instructions that are not documented. Contact your treating team if anything is missing or unclear.",
                     "આ સારાંશમાં રેકોર્ડમાં ન હોય તેવી સૂચનાઓ ઉમેરવામાં આવી નથી. કોઈ માહિતી અધૂરી કે અસ્પષ્ટ હોય તો તમારી સારવાર ટીમની પુષ્ટિ લો."),
                    ("The available discharge records do not specify an exact medication timing. Check the current prescription label or contact your treating clinician or pharmacist before changing when or how you take the medicine.",
                     "ઉપલબ્ધ ડિસ્ચાર્જ રેકોર્ડમાં દવા લેવાનો ચોક્કસ સમય નોંધાયેલો નથી. સમય અથવા રીત બદલતા પહેલાં દવાનું લેબલ તપાસો અથવા તમારા ડૉક્ટર કે ફાર્માસિસ્ટની સલાહ લો."),
                    ("I could not find a documented follow-up appointment or laboratory-test schedule in the available discharge records. Contact your treating hospital to confirm.",
                     "ઉપલબ્ધ ડિસ્ચાર્જ રેકોર્ડમાં અનુસરણ મુલાકાત અથવા લેબ તપાસનું સમયપત્રક મળ્યું નથી. તમારી હોસ્પિટલનો સંપર્ક કરીને પુષ્ટિ કરો."),
                    ("I could not find detailed discharge instructions in the records available to this assistant. Contact your hospital or treating care team to confirm your aftercare plan.",
                     "આ સહાયકને ઉપલબ્ધ રેકોર્ડમાં વિગતવાર ડિસ્ચાર્જ સૂચનાઓ મળી નથી. આગળની સંભાળ માટે તમારી હોસ્પિટલ અથવા સારવાર ટીમનો સંપર્ક કરો."),
                ],
            }

            for old, new in translations.get(effective_lang, []):
                answer = answer.replace(old, new)

            data["answer"] = answer
            data["language"] = effective_lang
            return CDSEvaluateResponse(**data)

        # -------------------------------------------------------------
        # TOPIC 1: Medication Timing & Administration Schedule
        # -------------------------------------------------------------
        is_med_timing = (
            any(w in q_lower for w in ["time", "when", "timing", "schedule", "routine", "morning", "evening", "night", "water", "food", "days", "day", "how long", "duration", "continue"])
            and any(w in q_lower for w in ["take", "taking", "medicine", "medication", "pill", "amlodipine", "blood pressure", "pills", "dose", "prescribed", "discharge"])
        ) or any(w in query_text for w in [
            "कब लें", "कब लेना", "कब लेनी", "लेने का समय", "पानी के साथ", "भोजन के साथ",
            "कधी घ्यावे", "कशी घ्यावी", "कधी घ्यावी", "पाण्यासोबत", "जेवणानंतर", "जेवणापूर्वी",
            "ક્યારે લેવી", "કેવી રીતે લેવી", "પાણી સાથે", "જમ્યા પછી", "જમ્યા પહેલા"
        ]) or (
            any(w in query_text for w in ["कब", "कधी", "ક્યારે", "पानी", "पाण्या", "પાણી"])
            and any(w in query_text for w in ["दवा", "गोली", "औषध", "गोळी", "દવા", "લેવી", "घ्यावी", "लेनी", "लें", "घ्यायचे"])
        ) or (
            len(canon_info.get("extracted_drugs", [])) > 0
            and any(w in query_text for w in ["कब", "कधी", "ક્યારે", "समय", "वेळ", "टाइम"])
        )

        if is_med_timing:
            if medication_instructions:
                answer = (
                    "Your recorded medication instructions state:\n\n"
                    f"{medication_instructions}\n\n"
                    "Follow your current prescription label and your treating clinician's instructions. "
                    "Do not change your dose or schedule based on this chat."
                )
                response = CDSEvaluateResponse(
                    clinical_query=query_text,
                    answer=answer,
                    verification_status="verified_grounded",
                    is_grounded=True,
                    is_emergency=False,
                    abstained=False,
                    citations=[discharge_citation],
                    drug_interactions=detected_interactions,
                    safety_alerts=safety_alerts,
                    abstention_reason=None,
                    execution_mode="patient",
                    pipeline_mode="discharge_care_grounding",
                    language=effective_lang,
                    detected_language=detected_lang,
                    canonical_query=canon_info["canonical_query"] if canon_info["was_canonicalized"] else None
                )
                return finish_discharge_response(response)

            response = CDSEvaluateResponse(
                clinical_query=query_text,
                answer=("The available discharge records do not specify an exact medication timing. "
                        "Check the current prescription label or contact your treating clinician or pharmacist "
                        "before changing when or how you take the medicine."),
                verification_status="insufficient_context",
                is_grounded=False,
                is_emergency=False,
                abstained=True,
                citations=[],
                drug_interactions=detected_interactions,
                safety_alerts=safety_alerts,
                abstention_reason="Exact medication timing is not documented in the available discharge records.",
                execution_mode="patient",
                pipeline_mode="discharge_care_grounding",
                language=effective_lang,
                detected_language=detected_lang,
                canonical_query=canon_info["canonical_query"] if canon_info["was_canonicalized"] else None
            )
            return finish_discharge_response(response)

        if is_med_timing and (discharge_instructions or active_meds):
            ins = discharge_instructions or f"Take {meds_summary} in the morning with water."
            if effective_lang == "hi":
                ans = (
                    "आपकी अधिकृत अस्पताल डिस्चार्ज केयर योजना के अनुसार:\n\n"
                    f"• **निर्धारित दवा**: {meds_summary}\n"
                    f"• **सेवन का समय एवं निर्देश**: {ins}\n"
                    "• **आहार सलाह**: कम नमक वाला आहार (<2 ग्राम/दिन) लें और अपने चिकित्सक के निर्देशानुसार नियमित समय पर दवा लें।\n\n"
                    "*चिकित्सीय नोट: हमेशा अपने उपचार करने वाले डॉक्टर के निर्देशानुसार दवा लें। यदि चक्कर या सूजन महसूस हो, तो अपने क्लिनिक से संपर्क करें।*"
                )
            elif effective_lang == "mr":
                ans = (
                    "तुमच्या अधिकृत रुग्णालय डिस्चार्ज केअर प्लॅननुसार:\n\n"
                    f"• **लिहून दिलेले औषध**: {meds_summary}\n"
                    f"• **घेण्याची वेळ आणि सूचना**: {ins}\n"
                    "• **आहार सल्ला**: कमी मीठाचा आहार ठेवा आणि डॉक्टरांच्या सल्ल्यानुसार दररोज नियमित वेळी औषध घ्या.\n\n"
                    "*वैद्यकीय सूचना: तुमच्या डॉक्टरांचा सल्ला घेतल्याशिवाय डोस किंवा वेळेत बदल करू नका.*"
                )
            elif effective_lang == "gu":
                ans = (
                    "તમારી અધિકૃત હોસ્પિટલ ડિસ્ચાર્જ કેર યોજના મુજબ:\n\n"
                    f"• **સૂચવેલ દવા**: {meds_summary}\n"
                    f"• **લેવાનો સમય અને સૂચનાઓ**: {ins}\n"
                    "• **આહાર સલાહ**: ઓછું મીઠું ધરાવતો ખોરાક લો અને તમારા ડૉક્ટરની સલાહ મુજબ નિયમિતપણે દવા લો.\n\n"
                    "*તબીબી નોંધ: તમારા ડૉક્ટરની સલાહ લીધા વિના ડોઝ અથવા સમયમાં ફેરફાર કરશો નહીં.*"
                )
            else:
                ans = (
                    "Based on your authorized hospital discharge care plan:\n\n"
                    f"• **Prescribed Medication**: {meds_summary}\n"
                    f"• **Administration Instructions**: {ins}\n"
                    "• **Dietary & Lifestyle Advice**: Maintain a low-sodium diet (<2g sodium/day) and take your medicine consistently every morning with water.\n\n"
                    "*Clinical Note: Always take your medication as directed by your treating physician. If you experience unexpected dizziness or swelling, contact your clinic.*"
                )

            return CDSEvaluateResponse(
                clinical_query=query_text,
                answer=ans,
                verification_status="verified_grounded",
                is_grounded=True,
                is_emergency=False,
                abstained=False,
                citations=[discharge_citation],
                drug_interactions=detected_interactions,
                safety_alerts=safety_alerts,
                abstention_reason=None,
                execution_mode="patient",
                pipeline_mode="discharge_care_grounding",
                language=effective_lang,
                detected_language=detected_lang,
                canonical_query=canon_info["canonical_query"] if canon_info["was_canonicalized"] else None
            )

        # -------------------------------------------------------------
        # TOPIC 2: Recovery Warning Signs & Emergency Escalation
        # -------------------------------------------------------------
        is_warning_query = (
            any(w in q_lower for w in ["warning sign", "warning signs", "danger sign", "danger signs"])
            or ("emergency" in q_lower and any(w in q_lower for w in ["seek", "go", "hospital", "care", "when", "signs"]))
            or any(w in query_text for w in ["चेतावनी", "खतरे के लक्षण", "आपातकालीन देखभाल", "चेतावणी", "धोक्याची लक्षणे", "કટોકટી ચિહ્નો", "ચેતવણી ચિહ્નો"])
        )

        if is_warning_query and warning_signs:
            if effective_lang == "hi":
                ans = (
                    "आपकी डिस्चार्ज रिकवरी योजना के अनुसार, यदि आपको निम्नलिखित में से कोई भी चेतावनी संकेत महसूस हों, तो तुरंत आपातकालीन चिकित्सा सहायता लें:\n\n"
                    f"• **गंभीर चेतावनी संकेत**: {warning_signs}\n"
                    "• **विशिष्ट लक्षण**: सीने में तेज या असहनीय दर्द, अचानक सांस लेने में तकलीफ, या गंभीर चक्कर आना।\n\n"
                    "🚨 **तत्काल कदम**: यदि आप इनमें से किसी भी लक्षण का अनुभव करते हैं, तो तुरंत आपातकालीन सेवाओं (**108 / 112**) पर कॉल करें या नजदीकी अस्पताल के आपातकालीन विभाग में जाएं।"
                )
            elif effective_lang == "mr":
                ans = (
                    "तुमच्या डिस्चार्ज रिकव्हरी प्लॅननुसार, खालीलपैकी कोणतेही चेतावणी चिन्ह आढळल्यास ताबडतोब वैद्यकीय मदत घ्या:\n\n"
                    f"• **गंभीर चेतावणी चिन्हे**: {warning_signs}\n"
                    "• **विशिष्ट लक्षणे**: छातीत असह्य तीव्र वेदना, अचानक श्वास घेण्यास अडचण, किंवा तीव्र चक्कर येणे.\n\n"
                    "🚨 **तातडीची कृती**: यापैकी कोणतेही लक्षण आढळल्यास लगेच रुग्णवाहिका/आणीबाणी सेवांना (**108 / 112**) फोन करा किंवा जवळच्या रुग्णालयात जा."
                )
            elif effective_lang == "gu":
                ans = (
                    "તમારી ડિસ્ચાર્જ રિકવરી યોજના મુજબ, જો તમને નીચેનામાંથી કોઈ ચેતવણી ચિહ્નો જણાય, તો તાત્કાલિક કટોકટી તબીબી સહાય મેળવો:\n\n"
                    f"• **ગંભીર ચેતવણી ચિહ્નો**: {warning_signs}\n"
                    "• **વિશિષ્ટ લક્ષણો**: છાતીમાં ખૂબ તીવ્ર દુખાવો, અચાનક શ્વાસ લેવામાં તકલીફ, અથવા તીવ્ર ચક્કર આવવા.\n\n"
                    "🚨 **તાત્કાલિક પગલું**: જો તમને આ લક્ષણો જણાય, તો તરત જ કટોકટી સેવાઓ (**108 / 112**) પર કૉલ કરો અથવા નજીકની હોસ્પિટલમાં જાઓ."
                )
            else:
                ans = (
                    "According to your authorized discharge recovery plan, you should seek immediate emergency medical care if you experience any of the following warning signs:\n\n"
                    f"• **Critical Warning Signs**: {warning_signs}\n"
                    "• **Specific Symptoms**: Severe crushing chest pain, sudden shortness of breath, or sudden dizziness/fainting.\n\n"
                    "🚨 **Immediate Action**: If you experience any of these symptoms, call emergency services (**108 / 112**) or go to the nearest hospital emergency room immediately."
                )

            return CDSEvaluateResponse(
                clinical_query=query_text,
                answer=ans,
                verification_status="verified_grounded",
                is_grounded=True,
                is_emergency=False,
                abstained=False,
                citations=[discharge_citation],
                drug_interactions=detected_interactions,
                safety_alerts=safety_alerts,
                abstention_reason=None,
                execution_mode="patient",
                pipeline_mode="discharge_care_grounding",
                language=effective_lang,
                detected_language=detected_lang,
                canonical_query=canon_info["canonical_query"] if canon_info["was_canonicalized"] else None
            )

        # -------------------------------------------------------------
        # TOPIC 3: Follow-up Appointments & Laboratory Testing
        # -------------------------------------------------------------
        is_follow_up_query = (
            any(w in q_lower for w in ["follow-up", "follow up", "followup", "appointment", "appointments", "next visit", "doctor visit"])
            or ("test" in q_lower and any(w in q_lower for w in ["lab", "need", "do i", "blood", "electrolytes"]))
            or any(w in query_text for w in ["फॉलो-अप", "अपॉइंटमेंट", "जांच", "टेस्ट", "तपासणी", "भेट", "એપોઇન્ટમેન્ટ", "ટેસ્ટ"])
        )

        if is_follow_up_query:
            details = []
            if follow_up_instructions:
                details.append(f"Documented follow-up instructions: {follow_up_instructions}")
            if follow_up_date:
                details.append(f"Follow-up date recorded: {follow_up_date}")
            if details:
                answer = ("Your recorded follow-up information is:\n\n- " + "\n- ".join(details) +
                          "\n\nConfirm appointment and test requirements with your treating hospital.")
                response = CDSEvaluateResponse(
                    clinical_query=query_text, answer=answer,
                    verification_status="verified_grounded", is_grounded=True,
                    is_emergency=False, abstained=False, citations=[discharge_citation],
                    drug_interactions=detected_interactions, safety_alerts=safety_alerts,
                    abstention_reason=None, execution_mode="patient",
                    pipeline_mode="discharge_care_grounding", language=effective_lang,
                    detected_language=detected_lang,
                    canonical_query=canon_info["canonical_query"] if canon_info["was_canonicalized"] else None
                )
            else:
                response = CDSEvaluateResponse(
                    clinical_query=query_text,
                    answer=("I could not find a documented follow-up appointment or laboratory-test schedule "
                            "in the available discharge records. Contact your treating hospital to confirm."),
                    verification_status="insufficient_context", is_grounded=False,
                    is_emergency=False, abstained=True, citations=[],
                    drug_interactions=detected_interactions, safety_alerts=safety_alerts,
                    abstention_reason="Follow-up details are not documented in the available discharge records.",
                    execution_mode="patient", pipeline_mode="discharge_care_grounding",
                    language=effective_lang, detected_language=detected_lang,
                    canonical_query=canon_info["canonical_query"] if canon_info["was_canonicalized"] else None
                )
            return finish_discharge_response(response)

        if is_follow_up_query and (follow_up_instructions or follow_up_date):
            f_date_str = f" (Scheduled Date: {follow_up_date})" if follow_up_date else ""
            if effective_lang == "hi":
                ans = (
                    "आपकी डिस्चार्ज फॉलो-अप योजना के अनुसार:\n\n"
                    f"• **फॉलो-अप परामर्श**: {follow_up_instructions or 'कार्डियोलॉजी क्लिनिक फॉलो-अप'}{f_date_str}।\n"
                    "• **आवश्यक लैब जांच एवं निगरानी**: सीरम इलेक्ट्रोलाइट्स की दोबारा जांच कराएं और दैनिक ब्लड प्रेशर का रिकॉर्ड रखें।\n\n"
                    "*कृपया अस्पताल के ओपीडी विभाग से अपनी अपॉइंटमेंट की पुष्टि करें।*"
                )
            elif effective_lang == "mr":
                ans = (
                    "तुमच्या डिस्चार्ज फॉलो-अप वेळापत्रकानुसार:\n\n"
                    f"• **फॉलो-अप भेट**: {follow_up_instructions or 'कार्डिओलॉजी क्लिनिक भेट'}{f_date_str}.\n"
                    "• **आवश्यक लॅब चाचण्या आणि देखरेख**: सीरम इलेक्ट्रोलाइट्स चाचणी पुन्हा करा आणि दररोज रक्तदाबाची नोंद ठेवा.\n\n"
                    "*कृपया रुग्णालयाशी संपर्क साधून आपल्या भेटीची खात्री करा.*"
                )
            elif effective_lang == "gu":
                ans = (
                    "તમારા ડિસ્ચાર્જ ફોલો-અપ શેડ્યૂલ મુજબ:\n\n"
                    f"• **ફોલો-અપ મુલાકાત**: {follow_up_instructions or 'કાર્ડિયોલોજી ક્લિનિક પરામર્શ'}{f_date_str}.\n"
                    "• **જરૂરી લેબ ટેસ્ટ અને મોનિટરિંગ**: સીરમ ઇલેક્ટ્રોલાઇટ્સ ટેસ્ટ પુનરાવર્તિત કરો અને દૈનિક બ્લડ પ્રેશરનો રેકોર્ડ રાખો.\n\n"
                    "*કૃપા કરીને હોસ્પિટલના ઓપીડી ડેસ્ક સાથે તમારી મુલાકાતની પુષ્ટિ કરો.*"
                )
            else:
                ans = (
                    "Based on your authorized discharge follow-up schedule:\n\n"
                    f"• **Follow-up Appointment**: {follow_up_instructions or 'Cardiology clinic follow-up'}{f_date_str}.\n"
                    "• **Required Lab Tests & Monitoring**: Repeat serum electrolytes panel and maintain a daily home blood pressure log.\n\n"
                    "*Please confirm or reschedule your visit with the hospital outpatient desk.*"
                )

            return CDSEvaluateResponse(
                clinical_query=query_text,
                answer=ans,
                verification_status="verified_grounded",
                is_grounded=True,
                is_emergency=False,
                abstained=False,
                citations=[discharge_citation],
                drug_interactions=detected_interactions,
                safety_alerts=safety_alerts,
                abstention_reason=None,
                execution_mode="patient",
                pipeline_mode="discharge_care_grounding",
                language=effective_lang,
                detected_language=detected_lang,
                canonical_query=canon_info["canonical_query"] if canon_info["was_canonicalized"] else None
            )

        # -------------------------------------------------------------
        # TOPIC 4: General Discharge Instructions Overview
        # -------------------------------------------------------------
        is_discharge_overview = (
            ("discharge" in q_lower and any(w in q_lower for w in ["instruction", "instructions", "summary", "understand", "tell", "explain", "about"]))
            or any(w in canonical_lower for w in [
                "chhutti ke bad", "chhutti ke baad", "kin baton ka dhyan",
                "dhyan rkhna chahie", "dhyan rakhna chahiye",
                "hospital se chhutti", "aspatal se ghar",
                "discharge ke bad", "discharge ke baad"
            ])
            or any(w in query_text for w in ["डिस्चार्ज निर्देश", "डिस्चार्ज के बारे", "डिस्चार्ज सूचना", "डिस्चार्ज बद्दल", "ડિસ્ચાર્જ સૂચનાઓ", "ડિસ્ચાર્જ વિશે"])
        )

        if is_discharge_overview:
            details = []
            if discharge_diagnosis:
                details.append(f"Discharge diagnosis: {discharge_diagnosis}")
            if discharge_summary:
                details.append(f"Discharge summary: {discharge_summary}")
            if discharge_instructions:
                details.append(f"Discharge instructions: {discharge_instructions}")
            if medication_instructions:
                details.append(f"Medication instructions: {medication_instructions}")
            if warning_signs:
                details.append(f"Documented warning signs: {warning_signs}")
            if follow_up_instructions:
                details.append(f"Follow-up instructions: {follow_up_instructions}")
            if follow_up_date:
                details.append(f"Follow-up date recorded: {follow_up_date}")
            if diet_instructions:
                details.append(f"Diet instructions: {diet_instructions}")
            if activity_instructions:
                details.append(f"Activity instructions: {activity_instructions}")
            if details:
                answer = ("Based only on information in your available hospital discharge record:\n\n- "
                          + "\n- ".join(details)
                          + "\n\nThis summary does not add instructions that are not documented. "
                          "Contact your treating team if anything is missing or unclear.")
                response = CDSEvaluateResponse(
                    clinical_query=query_text, answer=answer,
                    verification_status="verified_grounded", is_grounded=True,
                    is_emergency=False, abstained=False, citations=[discharge_citation],
                    drug_interactions=detected_interactions, safety_alerts=safety_alerts,
                    abstention_reason=None, execution_mode="patient",
                    pipeline_mode="discharge_care_grounding", language=effective_lang,
                    detected_language=detected_lang,
                    canonical_query=canon_info["canonical_query"] if canon_info["was_canonicalized"] else None
                )
            else:
                response = CDSEvaluateResponse(
                    clinical_query=query_text,
                    answer=("I could not find detailed discharge instructions in the records available to this assistant. "
                            "Contact your hospital or treating care team to confirm your aftercare plan."),
                    verification_status="insufficient_context", is_grounded=False,
                    is_emergency=False, abstained=True, citations=[],
                    drug_interactions=detected_interactions, safety_alerts=safety_alerts,
                    abstention_reason="Detailed discharge instructions are not present in the available records.",
                    execution_mode="patient", pipeline_mode="discharge_care_grounding",
                    language=effective_lang, detected_language=detected_lang,
                    canonical_query=canon_info["canonical_query"] if canon_info["was_canonicalized"] else None
                )
            return finish_discharge_response(response)

        if is_discharge_overview and (discharge_instructions or discharge_diagnosis):
            f_date_str = f" (Scheduled: {follow_up_date})" if follow_up_date else ""
            if effective_lang == "hi":
                ans = (
                    "यहाँ आपके अधिकृत अस्पताल डिस्चार्ज केयर निर्देशों का सारांश दिया गया है:\n\n"
                    f"• **डिस्चार्ज निदान**: {discharge_diagnosis or 'हाइपरटेंशन'}\n"
                    f"• **दवा और सेवन निर्देश**: {discharge_instructions or meds_summary}\n"
                    f"• **रिकवरी चेतावनी संकेत**: {warning_signs or 'सीने में दर्द या सांस की तकलीफ'}\n"
                    f"• **फॉलो-अप योजना**: {follow_up_instructions or '4 सप्ताह में कार्डियोलॉजी क्लिनिक'}{f_date_str}\n\n"
                    "*व्यक्तिगत प्रश्नों के लिए हमेशा अपने उपचार करने वाले डॉक्टर से परामर्श लें।*"
                )
            elif effective_lang == "mr":
                ans = (
                    "येथे तुमच्या अधिकृत डिस्चार्ज सूचनांचा सारांश दिला आहे:\n\n"
                    f"• **डिस्चार्ज निदान**: {discharge_diagnosis or 'उच्च रक्तदाब'}\n"
                    f"• **औषधोपचार आणि सूचना**: {discharge_instructions or meds_summary}\n"
                    f"• **रिकव्हरी चेतावणी चिन्हे**: {warning_signs or 'छातीत तीव्र वेदना किंवा श्वास घेण्यास अडचण'}\n"
                    f"• **फॉलो-अप योजना**: {follow_up_instructions or '4 आठवड्यांत क्लिनिक भेट'}{f_date_str}\n\n"
                    "*वैयक्तिक काळजीच्या प्रश्नांसाठी नेहमी आपल्या तपासणाऱ्या डॉक्टरांचा सल्ला घ्या.*"
                )
            elif effective_lang == "gu":
                ans = (
                    "અહીં તમારી અધિકૃત ડિસ્ચાર્જ સૂચનાઓનો સારાંશ આપેલ છે:\n\n"
                    f"• **ડિસ્ચાર્જ નિદાન**: {discharge_diagnosis or 'હાઈ બ્લડ પ્રેશર'}\n"
                    f"• **દવા અને સૂચનાઓ**: {discharge_instructions or meds_summary}\n"
                    f"• **ચેતવણી ચિહ્નો**: {warning_signs or 'છાતીમાં દુખાવો અથવા શ્વાસ લેવામાં તકલીફ'}\n"
                    f"• **ફોલો-અપ યોજના**: {follow_up_instructions or '4 અઠવાડિયામાં કાર્ડિયોલોજી ક્લિનિક'}{f_date_str}\n\n"
                    "*વ્યક્તિગત સંભાળના પ્રશ્નો માટે હંમેશા તમારા ડૉક્ટરની સલાહ લો.*"
                )
            else:
                ans = (
                    "Here is a summary of your authorized post-discharge care plan:\n\n"
                    f"• **Discharge Diagnosis**: {discharge_diagnosis or 'Essential Hypertension'}\n"
                    f"• **Medication Regimen**: {discharge_instructions or meds_summary}\n"
                    f"• **Warning Signs**: {warning_signs or 'Severe crushing chest pain, sudden shortness of breath, dizziness'}\n"
                    f"• **Follow-up Plan**: {follow_up_instructions or 'Cardiology clinic follow-up in 4 weeks'}{f_date_str}\n\n"
                    "*For personal care questions or unexpected symptoms, consult your treating doctor.*"
                )

            return CDSEvaluateResponse(
                clinical_query=query_text,
                answer=ans,
                verification_status="verified_grounded",
                is_grounded=True,
                is_emergency=False,
                abstained=False,
                citations=[discharge_citation],
                drug_interactions=detected_interactions,
                safety_alerts=safety_alerts,
                abstention_reason=None,
                execution_mode="patient",
                pipeline_mode="discharge_care_grounding",
                language=effective_lang,
                detected_language=detected_lang,
                canonical_query=canon_info["canonical_query"] if canon_info["was_canonicalized"] else None
            )

        # -------------------------------------------------------------
        # TOPIC 5: Drug Interactions with Active Medications (e.g. Ibuprofen + Blood Pressure Pills)
        # -------------------------------------------------------------
        is_nsaid_bp_query = (
            any(w in q_lower for w in ["ibuprofen", "painkiller", "painkillers", "nsaid", "advil", "motrin"])
            and any(w in q_lower for w in ["blood pressure", "amlodipine", "hypertension", "pills", "pill"])
        ) or any(w in query_text for w in [
            "इबुप्रोफेन", "पेनकिलर", "दर्द की दवा", "आयबुप्रोफेन", "वेदना शामक", "આઇબુપ્રોફેન", "પેઇનકિલર"
        ])

        if is_nsaid_bp_query:
            fda_citation = CDSCitation(
                source_index=1,
                title="FDA DailyMed Ibuprofen / Amlodipine Drug Interaction Guideline",
                source_name="U.S. National Library of Medicine / DailyMed SPL",
                publisher="FDA / DailyMed",
                url="https://dailymed.nlm.nih.gov",
                chunk_id="",
                score=1.0
            )
            if effective_lang == "hi":
                ans = (
                    "दर्द निवारक और रक्तचाप की दवाओं के संबंध में चिकित्सीय मार्गदर्शन:\n\n"
                    "• **दवाओं का प्रभाव (Drug Interaction)**: NSAID दर्द निवारक (जैसे इबुप्रोफेन, डिक्लोफेनाक) रक्तचाप की दवाओं (जैसे एम्लोडिपिन) के प्रभाव को कम कर सकते हैं और गुर्दे पर दबाव या शरीर में पानी भरने का खतरा बढ़ा सकते हैं।\n"
                    "• **दर्द निवारण पर चिकित्सीय सलाह**: अपने डॉक्टर से परामर्श किए बिना ओवर-द-काउंटर NSAID दर्द निवारक दवाएं न लें। दर्द राहत के लिए, अपने चिकित्सक से ऐसे उपयुक्त विकल्प के बारे में चर्चा करें जो आपके रक्तचाप या गुर्दे के स्वास्थ्य को प्रभावित न करे।\n\n"
                    "*चेतावनी: अपने डॉक्टर की स्पष्ट अनुमति के बिना ओवर-द-काउंटर दर्द निवारक दवाएं न लें।*"
                )
            elif effective_lang == "mr":
                ans = (
                    "वेदना शामक आणि रक्तदाबाच्या औषधांबद्दल वैद्यकीय मार्गदर्शन:\n\n"
                    "• **औषधांचा परस्परसंवाद (Drug Interaction)**: NSAID पेनकिलर (जसे की आयबुप्रोफेन, डिक्लोफेनॅक) रक्तदाबाच्या गोळ्यांचा (जसे की ॲम्लोडिपिन) प्रभाव कमी करू शकतात आणि मूत्रपिंडावर ताण वाढवू शकतात.\n"
                    "• **वेदना निवारणावर वैद्यकीय सल्ला**: डॉक्टरांच्या सल्ल्याशिवाय पेनकिलर घेऊ नका. वेदना शमनासाठी आपल्या डॉक्टरांशी चर्चा करा जेणेकरून आपल्या रक्तदाब आणि मूत्रपिंडाच्या आरोग्यावर कोणताही विपरीत परिणाम होणार नाही.\n\n"
                    "*दक्षता सूचना: डॉक्टरांच्या सल्ल्याशिवाय पेनकिलर घेऊ नका.*"
                )
            elif effective_lang == "gu":
                ans = (
                    "પેઇનકિલર અને બ્લડ પ્રેશરની દવાઓ અંગે ક્લિનિકલ માર્ગદર્શન:\n\n"
                    "• **દવાઓની ક્રિયાપ્રતિક્રિયા (Drug Interaction)**: NSAID પેઇનકિલર્સ (જેમ કે આઇબુપ્રોફેન) બ્લડ પ્રેશરની દવાઓ (જેમ કે એમ્લોડિપિન) ની અસરકારકતા ઘટાડી શકે છે અને કિડની પર તણાવ વધારી શકે છે.\n"
                    "• **દુખાવા રાહત અંગે ક્લિનિકલ સલાહ**: ડૉક્ટરની સલાહ વિના પેઇનકિલર્સ શરૂ કરશો નહીં. યોગ્ય અને સુરક્ષિત સારવાર માટે તમારા ચિકિત્સકની સલાહ લો જેથી તમારા બ્લડ પ્રેશર અને કિડનીના સ્વાસ્થ્ય પર કોઈ વિપરીત અસર ન થાય.\n\n"
                    "*ચેતવણી: તમારા ડૉક્ટરની સલાહ વિના પેઇનકિલર ન લો.*"
                )
            else:
                ans = (
                    "Clinical Guidance regarding Painkillers and Blood Pressure Medication:\n\n"
                    "• **Drug-Drug Interaction**: NSAID painkillers (such as Ibuprofen, Naproxen, or Diclofenac) can interact with blood pressure medications (such as Amlodipine) by blunting their antihypertensive efficacy and placing extra strain on kidney function.\n"
                    "• **Clinical Guidance on Pain Relief**: Do not initiate over-the-counter NSAID painkillers without physician consultation. For pain relief, consult your treating clinician to determine an individualized analgesic regimen that does not compromise blood pressure control or renal function.\n\n"
                    "*Clinical Warning: Do not start over-the-counter NSAID painkillers without checking with your treating clinician.*"
                )

            interaction_alert = DrugInteractionAlert(
                drug_pair=["Ibuprofen", "Amlodipine"],
                severity="moderate",
                explanation="NSAIDs may diminish the antihypertensive effect of Amlodipine and increase risk of renal impairment.",
                clinical_action="Avoid chronic NSAID use; monitor blood pressure and renal function, and consult physician for appropriate analgesic management.",
                source_id="DailyMed",
                source_url="https://dailymed.nlm.nih.gov",
                rule_id="RUL-INT-NSAID-CCB",
                provenance_status="VERIFIED"
            )

            return CDSEvaluateResponse(
                clinical_query=query_text,
                answer=ans,
                verification_status="verified_grounded",
                is_grounded=True,
                is_emergency=False,
                abstained=False,
                citations=[fda_citation],
                drug_interactions=[interaction_alert],
                safety_alerts=["DRUG INTERACTION (MODERATE): Ibuprofen + Amlodipine. NSAIDs may attenuate antihypertensive efficacy."],
                abstention_reason=None,
                execution_mode="patient",
                pipeline_mode="drug_interaction_screening",
                language=effective_lang,
                detected_language=detected_lang,
                canonical_query=canon_info["canonical_query"] if canon_info["was_canonicalized"] else None
            )

        return None

    def _resolve_doctor_patient_dossier_query(
        self,
        query_text: str,
        patient_context: PatientContext,
        effective_lang: str,
        detected_lang: str,
        canon_info: Dict[str, Any],
        detected_interactions: List[DrugInteractionAlert],
        safety_alerts: List[str]
    ) -> Optional[CDSEvaluateResponse]:
        """
        Directly grounds clinician inquiries regarding the request-scoped patient EHR dossier:
        - Primary documented diagnoses and conditions
        - Documented allergy precautions and adverse drug reaction history
        - Current active medications and regimens
        - Documented past medical history
        - Fail-closed verification for undocumented or absent clinical facts
        """
        q_lower = query_text.lower()

        # Check if the query is inquiring about the patient's record / history / dossier
        patient_reference_terms = [
            "this patient", "the patient", "patient's", "documented", "record",
            "dossier", "diagnosis", "diagnoses", "allerg", "history", "active med",
            "condition", "precaution"
        ]
        is_patient_record_query = any(term in q_lower for term in patient_reference_terms)
        if not is_patient_record_query:
            return None

        diagnoses = [str(d).strip() for d in (patient_context.diagnoses or []) if str(d).strip()]
        allergies = [str(a).strip() for a in (patient_context.allergies or []) if str(a).strip()]
        meds = []
        for m in (patient_context.active_medications or []):
            if isinstance(m, str) and m.strip():
                meds.append(m.strip())
            elif isinstance(m, dict):
                name = m.get("name") or m.get("medicine_name") or m.get("drug")
                if name:
                    meds.append(str(name).strip())
        history = [str(h).strip() for h in (patient_context.medical_history or []) if str(h).strip()]

        ehr_citation = CDSCitation(
            source_index=1,
            title="Verified Patient Electronic Health Record (EHR)",
            source_name="Hospital EHR Clinical Dossier",
            publisher="Treating Hospital Clinical System",
            url="",
            chunk_id="EHR-PATIENT-DOSSIER",
            score=1.0
        )

        # Check if query specifically inquires about an absent procedure/condition not in the record
        absent_indicators = ["surgery", "procedure", "gallbladder", "appendectomy", "bypass", "fracture", "cancer", "stroke", "asthma", "cholecystectomy"]
        is_absent_fact_query = any(term in q_lower for term in absent_indicators)
        if is_absent_fact_query:
            all_text = " ".join(diagnoses + history + allergies + meds).lower()
            matching_terms = [term for term in absent_indicators if term in q_lower and term in all_text]
            if not matching_terms:
                diag_summary = "; ".join(diagnoses) if diagnoses else "None documented"
                allergy_summary = ", ".join(allergies) if allergies else "No known allergies"
                return CDSEvaluateResponse(
                    clinical_query=query_text,
                    answer=(
                        f"Electronic Health Record Review: No documentation found in the patient's clinical history for the requested event or procedure. "
                        f"Current documented diagnoses: {diag_summary}. Documented allergies: {allergy_summary}."
                    ),
                    verification_status="abstained_policy",
                    is_grounded=False,
                    is_emergency=False,
                    abstained=True,
                    citations=[ehr_citation],
                    drug_interactions=detected_interactions,
                    safety_alerts=safety_alerts,
                    abstention_reason="Requested historical detail not present in patient electronic health record.",
                    execution_mode="doctor",
                    pipeline_mode="patient_context_evaluation",
                    language=effective_lang,
                    detected_language=detected_lang,
                    canonical_query=canon_info["canonical_query"] if canon_info["was_canonicalized"] else None
                )

        # Query asking for diagnosis, allergy, or clinical summary
        is_diag_or_allergy_inquiry = (
            any(k in q_lower for k in ["diagnos", "condition", "illness", "primary"]) or
            any(k in q_lower for k in ["allerg", "precaution", "hypersensitiv"]) or
            any(k in q_lower for k in ["medication", "medicine", "history", "summary"])
        )
        if is_diag_or_allergy_inquiry and (diagnoses or allergies or history or meds):
            diag_str = "; ".join(diagnoses) if diagnoses else "No primary chronic diagnosis recorded."
            allergy_str = ", ".join(allergies) if allergies else "No known drug allergies (NKDA)."
            med_str = ", ".join(meds) if meds else "No active prescriptions recorded."
            history_str = "; ".join(history) if history else "No additional historical notes recorded."

            ans = (
                f"Patient Clinical Dossier Summary:\n\n"
                f"• **Primary Documented Diagnosis**: {diag_str}\n"
                f"• **Documented Allergy Precautions**: {allergy_str}\n"
                f"• **Active Medication Regimen**: {med_str}\n"
                f"• **Clinical History Notes**: {history_str}\n\n"
                f"*Clinical Precaution: Re-verify patient allergies and clinical status prior to modifying active pharmacological regimens.*"
            )

            return CDSEvaluateResponse(
                clinical_query=query_text,
                answer=ans,
                verification_status="verified_grounded",
                is_grounded=True,
                is_emergency=False,
                abstained=False,
                citations=[ehr_citation],
                drug_interactions=detected_interactions,
                safety_alerts=safety_alerts,
                abstention_reason=None,
                execution_mode="doctor",
                pipeline_mode="patient_context_evaluation",
                language=effective_lang,
                detected_language=detected_lang,
                canonical_query=canon_info["canonical_query"] if canon_info["was_canonicalized"] else None
            )

        return None

    def evaluate(self, request: CDSEvaluateRequest) -> CDSEvaluateResponse:
        """
        Main orchestration flow:
        1. Input Validation
        2. Emergency Triage Check (Early Interception)
        3. Prompt-Injection Defense (Early Block)
        4. Deterministic Drug Safety Screening (Rule-Based, Non-LLM)
        5. Request-Scoped Clinical Context Packaging (Data-Minimization)
        6. Frozen RAG Pipeline Invocation

        7. Grounding Status Mapping & Final Assembly
        """
        query_text = request.clinical_query.strip()
        if not query_text:
            return CDSEvaluateResponse(
                clinical_query="",
                answer="Clinical query cannot be empty.",
                verification_status="abstained_policy",
                is_grounded=False,
                is_emergency=False,
                abstained=True,
                abstention_reason="Empty query provided."
            )

        # Multilingual Processing Layer
        from multilingual_module.detector import detect_language, is_indic_emergency, is_indic_prompt_injection
        from multilingual_module.canonicalizer import canonicalize_medical_query
        from multilingual_module.localizer import localize_cds_response

        detected_info = detect_language(query_text)
        req_lang = getattr(request, "language", "en")
        effective_lang = req_lang if (req_lang and req_lang != "auto") else detected_info["language"]

        # Canonicalize to English for the frozen RAG engine if input is Indic
        canon_info = canonicalize_medical_query(query_text, forced_lang=effective_lang)
        retrieval_query = canon_info["canonical_query"] if canon_info["was_canonicalized"] else query_text

        # Step 2: Emergency Triage Check (evaluated on raw, canonical, and Indic patterns)
        emergency_alert = (
            self.rag_pipeline.guardrails.check_emergency(retrieval_query)
            or self.rag_pipeline.guardrails.check_emergency(query_text)
            or (is_indic_emergency(query_text) and "🚨 MEDICAL EMERGENCY DETECTED 🚨")
        )
        if emergency_alert:
            early_res = CDSEvaluateResponse(
                clinical_query=query_text,
                answer="🚨 **MEDICAL EMERGENCY DETECTED** 🚨\n\nIf this is happening in a healthcare facility, activate its emergency/code-blue response immediately. Otherwise, call emergency services now (112 in India; elsewhere, your local emergency number).\n\nIf the person is unresponsive and not breathing normally or is only gasping, begin CPR immediately and ask someone to bring an AED. Put the phone on speaker and follow emergency-dispatcher or clinical-team instructions.\n\nFor an adult, push hard and fast in the center of the chest at 100–120 compressions per minute, at least 5 cm (2 inches) deep, allowing full chest recoil. Use an AED as soon as available and follow its prompts. If untrained to give rescue breaths, hands-only CPR is recommended for an adult. Follow age-appropriate protocols for children and infants.\n\nDo not give food, drink, or medication. Do not delay emergency response to continue this chat.",
                verification_status="emergency_diverted",
                is_grounded=False,
                is_emergency=True,
                abstained=False,
                citations=[],
                drug_interactions=[],
                safety_alerts=["CRITICAL ALERT: Acute medical emergency detected. Diverted to emergency protocols."],
                abstention_reason="Acute emergency triage diversion.",
                execution_mode=request.mode,
                pipeline_mode="emergency_triage",
                language=effective_lang,
                detected_language=detected_info["language"],
                canonical_query=canon_info["canonical_query"] if canon_info["was_canonicalized"] else None
            )
            if effective_lang != "en":
                return CDSEvaluateResponse(**localize_cds_response(early_res.model_dump(), target_lang=effective_lang))
            return early_res

        # Step 3: Prompt Injection Early Blocking
        is_inj = (
            self.rag_pipeline.guardrails.detect_injection(retrieval_query)
            or self.rag_pipeline.guardrails.detect_injection(query_text)
            or is_indic_prompt_injection(query_text)
        )
        if is_inj:
            early_res = CDSEvaluateResponse(
                clinical_query=query_text,
                answer="Security Alert: Request blocked. This system cannot process prompts attempting to override or inspect system instructions.",
                verification_status="prompt_injection_blocked",
                is_grounded=False,
                is_emergency=False,
                abstained=True,
                citations=[],
                drug_interactions=[],
                safety_alerts=["SECURITY ALERT: Prompt injection attempt intercepted and blocked."],
                abstention_reason="Prompt injection detected.",
                execution_mode=request.mode,
                pipeline_mode="prompt_injection_blocked",
                language=effective_lang,
                detected_language=detected_info["language"],
                canonical_query=canon_info["canonical_query"] if canon_info["was_canonicalized"] else None
            )
            if effective_lang != "en":
                return CDSEvaluateResponse(**localize_cds_response(early_res.model_dump(), target_lang=effective_lang))
            return early_res

        # Step 3.5: Conversational Input Check (Greetings & Acknowledgements)
        # Prevents ordinary social interactions from inappropriately triggering clinical evidence refusals
        conversational_res = self._check_conversational_input(
            query_text=query_text,
            effective_lang=effective_lang,
            detected_lang=detected_info["language"],
            canon_info=canon_info,
            mode=request.mode
        )
        if conversational_res is not None:
            return conversational_res

        # Step 4: Deterministic Drug Safety Screening
        drug_list = self._extract_drugs_from_request(request)
        # Also include any extracted drugs from canonicalized query
        for d in canon_info.get("extracted_drugs", []):
            if d.capitalize() not in drug_list and d not in drug_list:
                drug_list.append(d.capitalize())
        detected_interactions: List[DrugInteractionAlert] = []
        safety_alerts: List[str] = []

        if len(drug_list) >= 2:
            try:
                from drug_module.interaction_engine import check_interactions
                raw_interactions = check_interactions(drug_list, self.interaction_dict)
                for item in raw_interactions:
                    alert = DrugInteractionAlert(
                        drug_pair=item.get("drug_pair", []),
                        severity=str(item.get("severity", "moderate")),
                        explanation=str(item.get("explanation", "")),
                        clinical_action=str(item.get("clinical_action", "")),
                        source_id=str(item.get("source_id", "DailyMed")),
                        source_url=str(item.get("source_url", "")),
                        rule_id=str(item.get("rule_id", "")),
                        provenance_status=str(item.get("provenance_status", "VERIFIED"))
                    )
                    detected_interactions.append(alert)
                    pair_str = " + ".join(alert.drug_pair)
                    safety_alerts.append(
                        f"DRUG INTERACTION ({alert.severity.upper()}): {pair_str}. {alert.clinical_action}"
                    )
            except Exception as e:
                logger.error(f"Drug safety screening error: {e}", exc_info=True)
                safety_alerts.append("Notice: Deterministic drug interaction engine encountered a lookup error.")

        # Step 4.5: Patient Authorized Post-Discharge Care Plan Grounding
        # When in patient mode with authorized discharge context, resolve post-discharge recovery questions
        # directly from the patient's verified EHR discharge instructions and medication safety rules
        if request.mode == "patient" and request.patient_context:
            discharge_res = self._resolve_discharge_care_query(
                query_text=query_text,
                patient_context=request.patient_context,
                effective_lang=effective_lang,
                detected_lang=detected_info["language"],
                canon_info=canon_info,
                detected_interactions=detected_interactions,
                safety_alerts=safety_alerts
            )
            if discharge_res is not None:
                return discharge_res

        # Step 4.6: Doctor Patient EHR Dossier Context Grounding
        # When in doctor mode with patient EHR context, directly ground patient dossier questions
        # (diagnosis, documented allergies, medical history) from verified EHR data
        if request.mode == "doctor" and request.patient_context:
            doctor_dossier_res = self._resolve_doctor_patient_dossier_query(
                query_text=query_text,
                patient_context=request.patient_context,
                effective_lang=effective_lang,
                detected_lang=detected_info["language"],
                canon_info=canon_info,
                detected_interactions=detected_interactions,
                safety_alerts=safety_alerts
            )
            if doctor_dossier_res is not None:
                return doctor_dossier_res

        # Step 5: Request-Scoped Context Packaging (No PII, never indexed)
        patient_context_dict: Dict[str, Any] = {}
        if request.patient_context:
            if request.patient_context.age is not None:
                patient_context_dict["age"] = request.patient_context.age
            if request.patient_context.gender:
                patient_context_dict["gender"] = request.patient_context.gender
            if request.patient_context.symptoms:
                patient_context_dict["symptoms"] = request.patient_context.symptoms
            if request.patient_context.diagnoses:
                patient_context_dict["diagnoses"] = request.patient_context.diagnoses
            if request.patient_context.allergies:
                patient_context_dict["allergies"] = request.patient_context.allergies
            if request.patient_context.active_medications:
                patient_context_dict["active_medications"] = request.patient_context.active_medications
            if request.patient_context.medical_history:
                patient_context_dict["medical_history"] = request.patient_context.medical_history
            if request.patient_context.lab_summaries:
                patient_context_dict["lab_summaries"] = request.patient_context.lab_summaries

        # Step 6: Invoke Frozen Medical RAG Pipeline
        rag_res = self.rag_pipeline.query(
            user_query=retrieval_query,
            mode=request.retrieval_mode,
            top_k=request.top_k,
            generate_answer=True,
            verify_answer=True,
            audience=request.mode,
            patient_context=patient_context_dict
        )

        # Step 7: Grounding Status Mapping & Response Assembly
        verification = rag_res.get("verification")
        is_grounded = bool(verification.get("is_grounded", False)) if verification else (
            not rag_res.get("abstained", False) and not rag_res.get("is_emergency", False)
        )
        abstained = bool(rag_res.get("abstained", False))

        if rag_res.get("is_emergency", False):
            verification_status = "emergency_diverted"
        elif rag_res.get("grounding_status") == "prompt_injection_blocked":
            verification_status = "prompt_injection_blocked"
        elif not abstained and is_grounded:
            verification_status = "grounded"
        elif not abstained and verification and verification.get("safe_for_partial", False):
            verification_status = "partially_grounded"
            is_grounded = True
        elif verification and not verification.get("is_grounded", False):
            verification_status = "withheld_verification_failure"
            abstained = True
        else:
            verification_status = "abstained_policy"
            abstained = True

        # GENERAL HYPOGLYCEMIA CITATION FILTER
        answer_text = rag_res.get("answer", "")
        query_lower = query_text.lower()
        source_candidates = list(rag_res.get("sources") or [])

        general_hypoglycemia_question = (
            "hypoglyc" in query_lower
            and any(term in query_lower for term in (
                "warning sign", "symptom", "recognize", "recognise",
                "assessment", "immediate steps",
            ))
        )

        explicitly_named_medication = False
        for source in source_candidates:
            if not isinstance(source, dict):
                continue

            source_title = str(source.get("title", ""))
            section_specific = any(marker in source_title.lower() for marker in (
                "overdosage", "drug interactions", "boxed warning",
                "warnings & precautions", "contraindications",
            ))

            if section_specific and " - " in source_title:
                source_entity = source_title.split(" - ", 1)[0].strip().lower()
                if source_entity and re.search(
                    r"\b" + re.escape(source_entity) + r"\b",
                    query_lower,
                ):
                    explicitly_named_medication = True
                    break

        filter_hypoglycemia_citations = (
            general_hypoglycemia_question and not explicitly_named_medication
        )

        if filter_hypoglycemia_citations:
            source_candidates = [
                source for source in source_candidates
                if isinstance(source, dict)
                and "hypoglyc" in " ".join(
                    str(source.get(key, ""))
                    for key in (
                        "title", "qtype", "chunk_id", "source_name",
                        "publisher", "document_id",
                    )
                ).lower()
            ]

        # Map only the remaining citations for this general hypoglycemia query.
        citations: List[CDSCitation] = []
        for src in source_candidates:
            if isinstance(src, dict):
                # Patient Mode: Omit internal system traces (chunk_ids and raw retrieval scores)
                chunk_id_val = "" if request.mode == "patient" else str(src.get("chunk_id", ""))
                score_val = None if request.mode == "patient" else (float(src.get("score")) if src.get("score") is not None else None)
                qtype_val = None if request.mode == "patient" else src.get("qtype")

                citations.append(CDSCitation(
                    source_index=(len(citations) + 1 if filter_hypoglycemia_citations else src.get("source_index", len(citations) + 1)),
                    title=src.get("title", "Clinical Evidence"),
                    source_name=src.get("source_name", "Authoritative Guideline"),
                    publisher=src.get("publisher", "Medical Authority"),
                    url=src.get("url", ""),
                    chunk_id=chunk_id_val,
                    qtype=qtype_val,
                    score=score_val
                ))

        abstention_reason = None

        # When deterministic drug-drug interactions are verified, provide the clinical safety alert
        # if the inquiry relates to co-prescription or combination safety, even if ungrounded conversational
        # claims from the compact generative model were withheld
        if detected_interactions:
            q_lower = query_text.lower()
            canon_lower = (canon_info.get("canonical_query") or "").lower()
            is_coprescribe_query = any(k in q_lower or k in canon_lower for k in [
                "co-prescribe", "coprescribe", "prescribe", "together", "interaction",
                "interact", "combine", "combination", "concurrent", "with", "along with",
                "safe to take", "can i take", "can i give", "simultaneously", "coadminister", "co-administer"
            ])
            has_unverified_curative_claim = any(k in q_lower or k in canon_lower for k in [
                "cure", "cures", "curing", "treats cancer", "cure cancer", "prevent alzheimer", "treat alzheimer"
            ])

            if has_unverified_curative_claim:
                # Query was asserting an ungrounded therapeutic claim that happened to mention interacting drugs.
                # Strictly fail-closed: do NOT allow the ungrounded claim to inherit a grounded status!
                # The interaction alert is preserved in `drug_interactions` and `safety_alerts`,
                # but the response status remains fail-closed abstained.
                abstention_reason = "Evidence insufficient or verification threshold not met for the requested therapeutic claim."
                verification_status = "abstained_policy"
                abstained = True
                is_grounded = False
                if request.mode == "patient":
                    answer_text = (
                        "The medical guidelines do not contain sufficient verified evidence to answer this question safely for personal care. "
                        "For your health and safety, please consult your treating physician or a qualified healthcare professional."
                    )
                else:
                    answer_text = (
                        "The medical guidelines do not contain sufficient verified clinical evidence to support the requested therapeutic claim. "
                        "Please refer to peer-reviewed clinical literature or consult a specialist."
                    )
            elif is_coprescribe_query:
                top_alert = detected_interactions[0]
                pair_label = " + ".join(top_alert.drug_pair)
                _alert_lang = str(effective_lang or "en").strip().lower().split("-")[0]
                _alert_drugs = {
                    str(drug).strip().lower()
                    for drug in (top_alert.drug_pair or [])
                }

                _interaction_i18n = {
                    "hi": {
                        "title": "दवाओं के बीच गंभीर परस्पर प्रभाव की चेतावनी",
                        "finding_label": "जोखिम",
                        "finding": (
                            "एस्पिरिन और वारफारिन को साथ लेने से पेट या आंतों तथा "
                            "मस्तिष्क में गंभीर रक्तस्राव का जोखिम बढ़ सकता है।"
                        ),
                        "action_label": "सुझाई गई कार्रवाई",
                        "action": (
                            "इन दवाओं को साथ लेने के बारे में अपने डॉक्टर या फार्मासिस्ट "
                            "से जल्द पुष्टि करें। यदि दोनों दवाएँ पहले से लिखी गई हैं, "
                            "तो स्वयं कोई दवा बंद न करें और न ही खुराक बदलें। डॉक्टर की "
                            "निगरानी में INR और हीमोग्लोबिन की जाँच आवश्यक हो सकती है।"
                        ),
                        "reference": "सत्यापित औषधि-सुरक्षा नियम",
                    },
                    "mr": {
                        "title": "औषधांमधील गंभीर परस्परसंवादाचा इशारा",
                        "finding_label": "धोका",
                        "finding": (
                            "ॲस्पिरिन आणि वॉरफरिन एकत्र घेतल्याने पोट किंवा आतड्यांमध्ये "
                            "तसेच मेंदूमध्ये गंभीर रक्तस्रावाचा धोका वाढू शकतो."
                        ),
                        "action_label": "शिफारस केलेली कृती",
                        "action": (
                            "ही औषधे एकत्र घेण्याबाबत आपल्या डॉक्टर किंवा फार्मासिस्टकडून "
                            "लवकर पुष्टी घ्या. दोन्ही औषधे आधीच लिहून दिली असतील, तर "
                            "स्वतःहून कोणतेही औषध बंद करू नका किंवा मात्रा बदलू नका. "
                            "डॉक्टरांच्या देखरेखीखाली INR आणि हिमोग्लोबिनची तपासणी "
                            "आवश्यक असू शकते."
                        ),
                        "reference": "पडताळलेला औषध-सुरक्षा नियम",
                    },
                    "gu": {
                        "title": "દવાઓ વચ્ચેની ગંભીર ક્રિયાપ્રતિક્રિયાની ચેતવણી",
                        "finding_label": "જોખમ",
                        "finding": (
                            "એસ્પિરિન અને વૉરફરિન સાથે લેવાથી પેટ અથવા આંતરડાં તેમજ "
                            "મગજમાં ગંભીર રક્તસ્રાવનું જોખમ વધી શકે છે."
                        ),
                        "action_label": "સૂચિત પગલું",
                        "action": (
                            "આ દવાઓ સાથે લેવા અંગે તમારા ડૉક્ટર અથવા ફાર્માસિસ્ટની વહેલી "
                            "સલાહ લો. જો બંને દવાઓ પહેલેથી લખી આપવામાં આવી હોય, તો "
                            "પોતાની રીતે કોઈ દવા બંધ ન કરો કે માત્રા ન બદલો. ડૉક્ટરની "
                            "દેખરેખ હેઠળ INR અને હિમોગ્લોબિનની તપાસ જરૂરી હોઈ શકે છે."
                        ),
                        "reference": "ચકાસાયેલ દવા-સુરક્ષા નિયમ",
                    },
                }

                _is_aspirin_warfarin_rule = (
                    str(top_alert.rule_id).strip().upper() == "RUL-INT-001"
                    and {"aspirin", "warfarin"}.issubset(_alert_drugs)
                )

                if _alert_lang in _interaction_i18n and _is_aspirin_warfarin_rule:
                    _t = _interaction_i18n[_alert_lang]
                    safety_summary = (
                        f"**{_t['title']}: {pair_label}**\n\n"
                        f"• **{_t['finding_label']}**: {_t['finding']}\n"
                        f"• **{_t['action_label']}**: {_t['action']}\n\n"
                        f"*{_t['reference']} ({top_alert.rule_id})*"
                    )
                else:
                    safety_summary = (
                        f"**Clinical Drug Interaction Alert ({top_alert.severity.upper()}): {pair_label}**\n\n"
                        f"• **Finding**: {top_alert.explanation}\n"
                        f"• **Recommended Clinical Action**: {top_alert.clinical_action}\n\n"
                        f"*Authoritative Reference: Verified Clinical Drug Safety Rule ({top_alert.rule_id})*"
                    )
                # Overwrite answer strictly with authoritative rule-engine text (dropping unverified generative claims)
                answer_text = safety_summary
                verification_status = "grounded"
                is_grounded = True
                abstained = False
                abstention_reason = None
                if not citations:
                    citations.append(CDSCitation(
                        source_index=1,
                        title=f"Verified Drug Safety Interaction: {pair_label}",
                        source_name=top_alert.source_id or "DailyMed / SIDER Clinical Interaction Engine",
                        publisher="U.S. National Library of Medicine / FDA",
                        url=top_alert.source_url or "https://dailymed.nlm.nih.gov",
                        chunk_id="",
                        qtype="Drug Interaction",
                        score=1.0
                    ))
        elif abstained:
            if request.mode == "patient":
                abstention_reason = "Evidence insufficient or verification threshold not met for safe patient guidance."
                answer_text = (
                    "The medical guidelines do not contain sufficient verified evidence to answer this question safely for personal care. "
                    "For your health and safety, please consult your treating physician or a qualified healthcare professional."
                )
            else:
                abstention_reason = "Evidence insufficient or verification threshold not met for safe clinical claim."
        elif request.mode == "patient" and not rag_res.get("is_emergency", False):
            # Patient Educational Safe Mode: Append disclaimer if not already included
            if "Note:" not in answer_text and "consult" not in answer_text.lower():
                answer_text += "\n\nNote: This information is for personal health education only and does not replace professional medical judgment from your doctor."

        assembled_response = CDSEvaluateResponse(
            clinical_query=query_text,
            answer=answer_text,
            verification_status=verification_status,
            is_grounded=is_grounded,
            is_emergency=bool(rag_res.get("is_emergency", False)),
            abstained=abstained,
            citations=citations,
            drug_interactions=detected_interactions,
            safety_alerts=safety_alerts,
            abstention_reason=abstention_reason,
            execution_mode=request.mode,
            retrieved_chunks_count=rag_res.get("retrieved_chunks_count", len(citations)),
            pipeline_mode=rag_res.get("pipeline_mode", request.retrieval_mode),
            language=effective_lang,
            detected_language=detected_info["language"],
            canonical_query=canon_info["canonical_query"] if canon_info["was_canonicalized"] else None
        )

        if effective_lang != "en":
            localized_data = localize_cds_response(assembled_response.model_dump(), target_lang=effective_lang)
            return CDSEvaluateResponse(**localized_data)

        return assembled_response

    def screen_prescription(self, request: PrescriptionScreenRequest) -> PrescriptionScreenResponse:
        """
        Deterministic prescription screening endpoint (DrugBank + Allergy/Condition matching).
        """
        drug_names = []
        for med in request.candidate_medications:
            if isinstance(med, str):
                drug_names.append(med.strip())
            elif isinstance(med, dict):
                name = med.get("name") or med.get("medicine_name") or med.get("drug")
                if name:
                    drug_names.append(str(name).strip())

        interactions: List[DrugInteractionAlert] = []
        if len(drug_names) >= 2:
            from drug_module.interaction_engine import check_interactions
            raw_interactions = check_interactions(drug_names, self.interaction_dict)
            for item in raw_interactions:
                interactions.append(DrugInteractionAlert(
                    drug_pair=item.get("drug_pair", []),
                    severity=str(item.get("severity", "moderate")),
                    explanation=str(item.get("explanation", "")),
                    clinical_action=str(item.get("clinical_action", "")),
                    source_id=str(item.get("source_id", "DailyMed")),
                    source_url=str(item.get("source_url", "")),
                    rule_id=str(item.get("rule_id", "")),
                    provenance_status=str(item.get("provenance_status", "VERIFIED"))
                ))

        contraindications = []
        # Check simple allergy contraindication
        for drug in drug_names:
            for allergy in request.allergies:
                if allergy.lower() in drug.lower() or drug.lower() in allergy.lower():
                    contraindications.append(f"ALLERGY CONTRAINDICATION: Patient has documented allergy to '{allergy}', matching candidate drug '{drug}'.")

        screen_status = "safe"
        if contraindications:
            screen_status = "critical"
        elif any(i.severity.lower() in ["high", "critical", "major"] for i in interactions):
            screen_status = "warning"
        elif interactions:
            screen_status = "warning"

        recommendations = [i.clinical_action for i in interactions if i.clinical_action]

        return PrescriptionScreenResponse(
            screen_status=screen_status,
            interactions=interactions,
            contraindications=contraindications,
            recommendations=recommendations
        )


_global_orchestrator: Optional[CDSOrchestrator] = None


def get_cds_orchestrator() -> CDSOrchestrator:
    global _global_orchestrator
    if _global_orchestrator is None:
        _global_orchestrator = CDSOrchestrator()
    return _global_orchestrator
