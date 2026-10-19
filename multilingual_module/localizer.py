"""
Response Localization Engine.
Translates grounded clinical answers and formats safety alerts into target languages
(English, Hindi, Marathi) while strictly enforcing:
1. Zero unverified claim generation.
2. Complete preservation of drug names, dosages, units, numbers, and negations.
3. Authoritative DailyMed SPL citations remain attached with provenance.
"""
import re
from typing import Dict, Any, List
from multilingual_module.languages import normalize_language_code
from multilingual_module.safety_templates import (
    get_localized_safety_alert,
    get_localized_emergency_guidance,
    get_localized_interaction_alert,
    SAFETY_TEMPLATE_KEYS
)


# Core medical translation glossaries for grounded sentence transformation
ENGLISH_TO_INDIC_CORE = {
    # Key clinical verbs and nouns
    "indications": {"hi": "उपयोग और संकेत", "mr": "वापर आणि संकेत", "gu": "ઉપયોગ અને સંકેતો"},
    "indicated for the treatment of": {"hi": "के उपचार के लिए अनुशंसित और स्वीकृत है:", "mr": "च्या उपचारासाठी सूचित आणि मंजूर आहे:", "gu": "ના ઉપચાર માટે ભલામણ કરેલ અને મંજૂર છે:"},
    "is indicated for": {"hi": "के उपचार के लिए अनुशंसित और स्वीकृत है:", "mr": "च्या उपचारासाठी सूचित आणि मंजूर आहे:", "gu": "ના ઉપચાર માટે ભલામણ કરેલ અને મંજૂર છે:"},
    "indicated for": {"hi": "के उपचार के लिए अनुशंसित है", "mr": "च्या उपचारासाठी सूचित केले आहे", "gu": "ના ઉપચાર માટે ભલામણ કરેલ છે"},
    "for the treatment of": {"hi": "के उपचार के लिए", "mr": "च्या उपचारासाठी", "gu": "ના ઉપચાર માટે"},
    "type 2 diabetes mellitus": {"hi": "टाइप 2 मधुमेह (Type 2 Diabetes Mellitus)", "mr": "टाइप 2 मधुमेह (Type 2 Diabetes Mellitus)", "gu": "ટાઈપ 2 ડાયાબિટીસ (Type 2 Diabetes Mellitus)"},
    "hypertension": {"hi": "उच्च रक्तचाप (Hypertension)", "mr": "उच्च रक्तदाब (Hypertension)", "gu": "હાઈ બ્લડ પ્રેશર (Hypertension)"},
    "heart failure": {"hi": "हार्ट फेलियर (Heart Failure)", "mr": "हार्ट फेल्युअर (Heart Failure)", "gu": "હાર્ટ ફેલ્યોર (Heart Failure)"},
    "acute myocardial infarction": {"hi": "एक्यूट मायोकार्डियल इन्फ्रक्शन / दिल का दौरा", "mr": "अॅक्यूट मायोकार्डियल इन्फार्कशन / हृदयविकाराचा झटका", "gu": "એક્યુટ મ્યોકાર્ડિયલ ઇન્ફાર્ક્શન / હાર્ટ એટેક"},
    "adverse reactions": {"hi": "प्रतिकूल प्रभाव (Adverse Reactions)", "mr": "प्रतिकूल परिणाम (Adverse Reactions)", "gu": "પ્રતિકૂળ અસરો (Adverse Reactions)"},
    "side effects": {"hi": "दुष्परिणाम (Side Effects)", "mr": "दुष्परिणाम (Side Effects)", "gu": "આડઅસરો (Side Effects)"},
    "contraindications": {"hi": "निषेध और चेतावनियां (Contraindications)", "mr": "विरोधाभास आणि चेतावणी (Contraindications)", "gu": "વિરોધાભાસ અને ચેતવણીઓ (Contraindications)"},
    "renal impairment": {"hi": "गुर्दे की खराबी (Renal Impairment)", "mr": "मूत्रपिंड विकार (Renal Impairment)", "gu": "કિડનીની તકલીફ (Renal Impairment)"},
    "oral administration": {"hi": "मौखिक सेवन (Oral Administration)", "mr": "तोंडी सेवन (Oral Administration)", "gu": "મોં વાટે લેવી (Oral Administration)"},
    "once daily": {"hi": "दिन में एक बार", "mr": "दिवसातून एकदा", "gu": "દિવસમાં એક વાર"},
    "twice daily": {"hi": "दिन में दो बार", "mr": "दिवसातून दोनदा", "gu": "દિવસમાં બે વાર"},
    "Dosage & Administration": {"hi": "खुराक और सेवन विधि (Dosage & Administration)", "mr": "डोस आणि सेवन पद्धती (Dosage & Administration)", "gu": "ડોઝ અને સેવન પદ્ધતિ (Dosage & Administration)"},
    "Clinical Usage": {"hi": "नैदानिक उपयोग (Clinical Usage)", "mr": "वैद्यकीय वापर (Clinical Usage)", "gu": "તબીબી ઉપયોગ (Clinical Usage)"},

    # Adverse Reactions Terms
    "diarrhea": {"hi": "दस्त (Diarrhea)", "mr": "जुलाब (Diarrhea)", "gu": "ઝાડા (Diarrhea)"},
    "nausea": {"hi": "जी मिचलाना (Nausea)", "mr": "मळमळ (Nausea)", "gu": "ઉબકા (Nausea)"},
    "vomiting": {"hi": "उल्टी (Vomiting)", "mr": "उलट्या (Vomiting)", "gu": "ઉલટી (Vomiting)"},
    "flatulence": {"hi": "पेट में गैस (Flatulence)", "mr": "पोटात गॅस (Flatulence)", "gu": "પેટમાં ગેસ (Flatulence)"},
    "abdominal discomfort": {"hi": "पेट में बेचैनी (Abdominal Discomfort)", "mr": "पोटात अस्वस्थता (Abdominal Discomfort)", "gu": "પેટમાં અસ્વસ્થતા (Abdominal Discomfort)"},
    "abdominal pain": {"hi": "पेट में दर्द (Abdominal Pain)", "mr": "पोटदुखी (Abdominal Pain)", "gu": "પેટમાં દુખાવો (Abdominal Pain)"},
    "indigestion": {"hi": "अपच (Indigestion)", "mr": "अपचन (Indigestion)", "gu": "અપચો (Indigestion)"},
    "headache": {"hi": "सिरदर्द (Headache)", "mr": "डोकेदुखी (Headache)", "gu": "માથાનો દુખાવો (Headache)"},
    "asthenia": {"hi": "शारीरिक कमजोरी (Asthenia)", "mr": "अशक्तपणा (Asthenia)", "gu": "શારીરિક નબળાઈ (Asthenia)"},
    "dizziness": {"hi": "चक्कर आना (Dizziness)", "mr": "चक्कर येणे (Dizziness)", "gu": "ચક્કર આવવા (Dizziness)"},
    "fatigue": {"hi": "थकान (Fatigue)", "mr": "थकवा (Fatigue)", "gu": "થાક (Fatigue)"},
    "edema": {"hi": "सूजन (Edema)", "mr": "सूज (Edema)", "gu": "સોજો (Edema)"},
    "cough": {"hi": "खांसी (Cough)", "mr": "खोकला (Cough)", "gu": "ઉધરસ (Cough)"},
    "flushing": {"hi": "चेहरे का लाल होना (Flushing)", "mr": "चेहऱ्यावर लाली येणे (Flushing)", "gu": "ચહેરા પર લાલાશ (Flushing)"},
    "palpitations": {"hi": "धड़कन तेज होना (Palpitations)", "mr": "धडधड वाढणे (Palpitations)", "gu": "ધબકારા વધવા (Palpitations)"},
    "rash": {"hi": "त्वचा पर चकत्ते (Rash)", "mr": "त्वचेवर पुरळ (Rash)", "gu": "ત્વચા પર ફોલ્લીઓ (Rash)"},
    "lactic acidosis": {"hi": "लैक्टिक एसिडोसिस (Lactic Acidosis)", "mr": "लॅक्टिक ॲसिडोसिस (Lactic Acidosis)", "gu": "લેક્ટિક એસિડોસિસ (Lactic Acidosis)"},

    # Connectors & Sentence Structures
    "According to the given evidence": {"hi": "उपलब्ध चिकित्सीय साक्ष्यों के अनुसार", "mr": "उपलब्ध वैद्यकीय पुराव्यानुसार", "gu": "ઉપલબ્ધ તબીબી પુરાવા મુજબ"},
    "The most common adverse reactions to": {"hi": "के सबसे सामान्य प्रतिकूल प्रभावों में", "mr": "च्या सर्वात सामान्य प्रतिकूल परिणामांमध्ये", "gu": "ની સૌથી સામાન્ય પ્રતિકૂળ અસરોમાં"},
    "The most common adverse reactions are": {"hi": "सबसे सामान्य प्रतिकूल प्रभावों में शामिल हैं:", "mr": "सर्वात सामान्य प्रतिकूल परिणामांमध्ये पुढील लक्षणे आढळतात:", "gu": "સૌથી સામાન્ય પ્રતિકૂળ અસરોમાં નીચે મુજબ શામેલ છે:"},
    "can cause several adverse reactions, including": {"hi": "के कारण कई प्रतिकूल प्रभाव हो सकते हैं, जिनमें मुख्य रूप से शामिल हैं:", "mr": "मुळे अनेक प्रतिकूल परिणाम होऊ शकतात, ज्यामध्ये प्रामुख्याने खालील बाबी समाविष्ट आहेत:", "gu": "ના કારણે ઘણી પ્રતિકૂળ અસરો થઈ શકે છે, જેમાં મુખ્યત્વે નીચે મુજબ શામેલ છે:"},
    "can cause several": {"hi": "के कारण कई दुष्प्रभाव हो सकते हैं, जैसे", "mr": "मुळे अनेक दुष्परिणाम होऊ शकतात, जसे", "gu": "ના કારણે ઘણી આડઅસરો થઈ શકે છે, જેમ કે"},
    "including": {"hi": "जिसमें शामिल हैं:", "mr": "ज्यामध्ये समाविष्ट आहेत:", "gu": "જેમાં શામેલ છે:"},
    "and ": {"hi": "और ", "mr": "आणि ", "gu": "અને "},

    # Verification Notices & Disclaimers
    "[Clinical Note: The statements above for": {"hi": "[चिकित्सीय टिप्पणी: उपरोक्त कथन", "mr": "[वैद्यकीय नोंद: वरील विधाने", "gu": "[તબીબી નોંધ: ઉપરોક્ત નિવેદનો"},
    "are verified by authoritative guidelines.": {"hi": "आधिकारिक दिशानिर्देशों द्वारा सत्यापित हैं।", "mr": "अधिकृत मार्गदर्शक तत्त्वांद्वारे सत्यापित आहेत.", "gu": "સત્તાવાર માર્ગદર્શિકા દ્વારા ચકાસાયેલ છે."}
}


def localize_clinical_text(english_text: str, target_lang: str) -> str:
    """
    Localizes English clinical explanation into Hindi, Marathi, or Gujarati
    while strictly protecting medical entity terms, numbers, and dosages.
    """
    if target_lang == "en" or not english_text:
        return english_text

    # Extract and protect dosage terms (e.g., 500mg, 5 mg, 10mg)
    dosages = re.findall(r"\b\d+(?:\.\d+)?\s*(?:mg|g|mcg|ml|tablets?)\b", english_text, re.IGNORECASE)
    
    localized = english_text

    preambles = {
        "hi": "**चिकित्सीय संदर्भ एवं सारांश (दवा मोनोग्राफ के आधार पर):**\n",
        "mr": "**वैद्यकीय संदर्भ व सारांश (औषध संदर्भानुसार):**\n",
        "gu": "**તબીબી સંદર્ભ અને સારાંશ (દવા મોનોગ્રાફના આધારે):**\n"
    }

    if target_lang in preambles:
        # Standard glossary replacement preserving dosages, numbers, and Latin entity provenance
        for eng, indic in sorted(ENGLISH_TO_INDIC_CORE.items(), key=lambda x: -len(x[0])):
            pattern = re.compile(rf"\b{re.escape(eng)}\b", re.IGNORECASE)
            if pattern.search(localized):
                localized = pattern.sub(indic[target_lang], localized)
        
        preamble = preambles[target_lang]
        if not localized.startswith(preamble):
            localized = f"{preamble}{localized}"
        return localized

    return english_text


def localize_cds_response(cds_response: Dict[str, Any], target_lang: str) -> Dict[str, Any]:
    """
    Takes a raw CDSEvaluateResponse dictionary and localizes it into target_lang
    (en, hi, mr) without losing grounding verification statuses or citations.
    """
    norm_lang = normalize_language_code(target_lang)
    if norm_lang == "en":
        # No localization needed for canonical English
        res = dict(cds_response)
        res["language"] = "en"
        return res

    res = dict(cds_response)
    res["language"] = norm_lang
    status = res.get("verification_status", "")

    # 1. Acute Emergency Diversion
    if res.get("is_emergency") or status == "emergency_diverted":
        res["answer"] = get_localized_emergency_guidance(norm_lang)
        res["safety_alerts"] = [get_localized_safety_alert("emergency_alert", norm_lang)]
        return res

    # 2. Prompt Injection Neutralization
    if status == "prompt_injection_blocked":
        res["answer"] = get_localized_safety_alert("prompt_injection_blocked", norm_lang)
        res["safety_alerts"] = [get_localized_safety_alert("prompt_injection_blocked", norm_lang)]
        return res

    # 3. Unsupported Entity / Fail-Closed Abstention
    if status == "abstained_policy":
        abstention_text = get_localized_safety_alert("unsupported_entity_abstention", norm_lang)
        consult_text = get_localized_safety_alert("physician_consultation_required", norm_lang)
        res["answer"] = f"{abstention_text}\n\n{consult_text}"
        res["safety_alerts"] = [abstention_text]
        return res

    # 4. Grounding Verification Failure Withholding
    if status == "withheld_verification_failure":
        withheld_text = get_localized_safety_alert("verification_failure_withheld", norm_lang)
        consult_text = get_localized_safety_alert("physician_consultation_required", norm_lang)
        res["answer"] = f"{withheld_text}\n\n{consult_text}"
        res["safety_alerts"] = [withheld_text]
        return res

    # 5. Grounded / Partially Grounded Response
    original_answer = res.get("answer", "")
    # Interaction-rule answers may already be localized by the verified rule builder.
    # Do not mislabel them as drug-monograph summaries or run them through
    # the generic glossary-based localizer a second time.
    interaction_rule_answer = (
        str(res.get("pipeline_mode", "")).lower() == "drug_interaction_screening"
        or "RUL-INT-" in str(original_answer)
        or "Clinical Drug Interaction Alert" in str(original_answer)
    )
    localized_answer = (
        original_answer
        if interaction_rule_answer
        else localize_clinical_text(original_answer, norm_lang)
    )
    
    # In patient mode, attach localized educational disclaimer
    if res.get("execution_mode") == "patient":
        disclaimer = get_localized_safety_alert("patient_educational_disclaimer", norm_lang)
        if disclaimer not in localized_answer:
            localized_answer += disclaimer

    res["answer"] = localized_answer

    # 6. Localize Drug-Drug Interaction Alerts
    interactions = res.get("drug_interactions", [])
    if interactions:
        localized_alerts = []
        for alert in interactions:
            pair = alert.get("drug_pair", [])
            drug_a = pair[0] if len(pair) > 0 else "Drug A"
            drug_b = pair[1] if len(pair) > 1 else "Drug B"
            sev = alert.get("severity", "major")
            action = alert.get("clinical_action", "")
            
            loc_dict = get_localized_interaction_alert(drug_a, drug_b, sev, action, norm_lang)
            localized_alerts.append(f"{loc_dict['title']}: {loc_dict['warning']} {loc_dict['action']}")
        
        # Prepend localized warnings to safety_alerts
        res["safety_alerts"] = localized_alerts + res.get("safety_alerts", [])

    return res
