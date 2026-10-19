"""
Deterministic, Authoritative Safety-Critical Multilingual Templates.
Guarantees absolute meaning preservation for:
- Emergency triage guidance
- Prompt injection defense alerts
- Grounding verification failures
- Drug-drug interaction warnings
- Physician consultation disclaimers
- Strict clinical negations and dosage numbers

NEVER allows unconstrained generative translation of safety-critical clinical alerts.
"""
from typing import Dict, Any, Optional
from multilingual_module.languages import SupportedLanguage, normalize_language_code


SAFETY_TEMPLATE_KEYS = {
    "EMERGENCY_ALERT": "emergency_alert",
    "EMERGENCY_GUIDANCE": "emergency_guidance",
    "PROMPT_INJECTION_BLOCKED": "prompt_injection_blocked",
    "UNSUPPORTED_ENTITY_ABSTENTION": "unsupported_entity_abstention",
    "OUT_OF_DOMAIN_ABSTENTION": "out_of_domain_abstention",
    "VERIFICATION_FAILURE_WITHHELD": "verification_failure_withheld",
    "DRUG_INTERACTION_ALERT": "drug_interaction_alert",
    "PHYSICIAN_CONSULTATION_REQUIRED": "physician_consultation_required",
    "PATIENT_EDUCATIONAL_DISCLAIMER": "patient_educational_disclaimer",
    "CONVERSATIONAL_GREETING": "conversational_greeting",
    "CONVERSATIONAL_ACKNOWLEDGEMENT": "conversational_acknowledgement",
}


SAFETY_TEMPLATES: Dict[str, Dict[str, str]] = {
    # -------------------------------------------------------------------------
    # 1. EMERGENCY TRIAGE
    # -------------------------------------------------------------------------
    "emergency_alert": {
        "en": "CRITICAL ALERT: Acute medical emergency detected. Diverted to immediate emergency protocols.",
        "hi": "गंभीर आपातकालीन चेतावनी: तीव्र चिकित्सीय आपातकाल का पता चला है। तत्काल आपातकालीन प्रोटोकॉल पर पुनर्निर्देशित किया गया।",
        "mr": "गंभीर आणीबाणी इशारा: तीव्र वैद्यकीय आणीबाणी आढळली आहे. तातडीने आणीबाणी प्रोटोकॉलकडे वळवले गेले आहे.",
        "gu": "ગંભીર કટોકટી ચેતવણી: તીવ્ર તબીબી કટોકટી જણાઈ છે. તાત્કાલિક કટોકટી પ્રોટોકોલ પર રીડાયરેક્ટ કરવામાં આવ્યું.",
    },
    "emergency_guidance": {
        "en": (
            "EMERGENCY MEDICAL WARNING:\n"
            "This query describes acute, potentially life-threatening symptoms (e.g. acute poisoning, chest pain, anaphylaxis, severe breathing distress).\n\n"
            "IMMEDIATE ACTIONS REQUIRED:\n"
            "1. Call local emergency medical services immediately (112 / 108 in India, 911 in US) or proceed to the nearest hospital emergency department.\n"
            "2. Do NOT wait for automated clinical decision support or online advice.\n"
            "3. If acute poisoning is suspected, contact the National Poisons Information Centre immediately."
        ),
        "hi": (
            "आपातकालीन चिकित्सा चेतावनी:\n"
            "यह प्रश्न संभावित रूप से जीवन-घातक गंभीर लक्षणों (जैसे तीव्र विषाक्तता, सीने में दर्द, एनाफिलेक्सिस, सांस लेने में गंभीर तकलीफ) का वर्णन करता है।\n\n"
            "तत्काल आवश्यक कदम:\n"
            "1. तुरंत स्थानीय आपातकालीन चिकित्सा सेवाओं को कॉल करें (भारत में 112 / 108, अमेरिका में 911) या नजदीकी अस्पताल के आपातकालीन विभाग में जाएं।\n"
            "2. स्वचालित चिकित्सीय निर्णय प्रणाली या ऑनलाइन सलाह की प्रतीक्षा न करें।\n"
            "3. यदि तीव्र विषाक्तता का संदेह है, तो तुरंत राष्ट्रीय विष सूचना केंद्र से संपर्क करें।"
        ),
        "mr": (
            "तातडीची वैद्यकीय आणीबाणी सूचना:\n"
            "या प्रश्नामध्ये संभाव्य जीवघेणी तीव्र लक्षणे (उदा. विषबाधा, छातीत तीव्र वेदना, श्वास घेण्यास अडचण, ॲनाफिलेक्सिस) आढळून आली आहेत.\n\n"
            "तातडीने करावयाची कृती:\n"
            "1. त्वरित स्थानिक रुग्णवाहिका किंवा आणीबाणी सेवांशी संपर्क साधा (भारतात 112 / 108) किंवा जवळच्या रुग्णालयातील आपत्कालीन विभागात जा.\n"
            "2. स्वयंचलित डिजिटल सल्ला किंवा ऑनलाइन उत्तराची वाट पाहू नका.\n"
            "3. विषबाधा झाली असल्यास त्वरित विष नियंत्रण केंद्राशी संपर्क साधा."
        ),
        "gu": (
            "કટોકટી તબીબી ચેતવણી:\n"
            "આ પ્રશ્ન સંભવિત જીવન-જોખમી ગંભીર લક્ષણો (જેમ કે તીવ્ર ઝેર, છાતીમાં દુખાવો, એનાફિલેક્સિસ, શ્વાસ લેવામાં ગંભીર તકલીફ) દર્શાવે છે.\n\n"
            "તાત્કાલિક જરૂરી પગલાં:\n"
            "1. તાત્કાલિક સ્થાનિક કટોકટી તબીબી સેવાઓનો સંપર્ક કરો (ભારતમાં 112 / 108, યુ.એસ.માં 911) અથવા નજીકની હોસ્પિટલના ઇમરજન્સી વિભાગમાં જાઓ.\n"
            "2. સ્વચાલિત ક્લિનિકલ નિર્ણય સપોર્ટ અથવા ઓનલાઇન સલાહની રાહ ન જુઓ.\n"
            "3. જો તીવ્ર ઝેરની શંકા હોય, તો તાત્કાલિક રાષ્ટ્રીય ઝેર માહિતી કેન્દ્રનો સંપર્ક કરો."
        ),
    },

    # -------------------------------------------------------------------------
    # 2. PROMPT INJECTION / SECURITY
    # -------------------------------------------------------------------------
    "prompt_injection_blocked": {
        "en": "Security Alert: Query intercepted by prompt-injection safety firewall. Non-clinical instructions neutralized.",
        "hi": "सुरक्षा चेतावनी: प्रॉम्प्ट-इंजेक्शन सुरक्षा फ़ायरवॉल द्वारा प्रश्न को रोक दिया गया है। गैर-चिकित्सीय निर्देशों को निष्प्रभावी किया गया।",
        "mr": "सुरक्षा इशारा: प्रॉम्प्ट-इंजेक्शन सुरक्षा प्रणालीद्वारे प्रश्न रोखण्यात आला आहे. गैर-वैद्यकीय सूचना निष्प्रभ करण्यात आल्या आहेत.",
        "gu": "સુરક્ષા ચેતવણી: પ્રોમ્પ્ટ-ઇન્જેક્શન સુરક્ષા ફાયરવોલ દ્વારા પ્રશ્ન અટકાવવામાં આવ્યો છે. બિન-તબીબી સૂચનાઓ નિષ્ક્રિય કરવામાં આવી છે.",
    },

    # -------------------------------------------------------------------------
    # 3. UNSUPPORTED ENTITY / FAIL-CLOSED ABSTENTION
    # -------------------------------------------------------------------------
    "unsupported_entity_abstention": {
        "en": (
            "Evidence Policy Abstention: The requested entity or medication is not indexed within the authoritative FDA DailyMed monograph repository. "
            "In accordance with clinical safety policy, generation is safely withheld fail-closed to prevent hallucination."
        ),
        "hi": (
            "प्रमाण नीति के तहत सुरक्षित अस्वीकृति: अनुरोधित दवा या चिकित्सीय घटक आधिकारिक FDA DailyMed मोनोग्राफ रिपॉजिटरी में अनुक्रमित नहीं है। "
            "चिकित्सीय सुरक्षा नीति के अनुसार, संभावित भ्रामक जानकारी (हैलुसिनेशन) को रोकने के लिए उत्तर सुरक्षित रूप से रोका गया है।"
        ),
        "mr": (
            "पुरावा धोरणानुसार सुरक्षित नकार: विचारलेले औषध किंवा घटक अधिकृत FDA DailyMed संदर्भ सूचीमध्ये समाविष्ट नाही. "
            "वैद्यकीय सुरक्षिततेच्या नियमांनुसार, चुकीची माहिती टाळण्यासाठी उत्तर सुरक्षितपणे रोखून ठेवले आहे."
        ),
        "gu": (
            "પુરાવા નીતિ અસ્વીકૃતિ: વિનંતી કરેલ દવા અથવા તબીબી ઘટક અધિકૃત FDA DailyMed મોનોગ્રાફ રિપોઝિટરીમાં અનુક્રમિત નથી. "
            "ક્લિનિકલ સલામતી નીતિ અનુસાર, ખોટી માહિતી રોકવા માટે જવાબ સુરક્ષિત રીતે અટકાવવામાં આવ્યો છે."
        ),
    },

    # -------------------------------------------------------------------------
    # 4. OUT OF DOMAIN
    # -------------------------------------------------------------------------
    "out_of_domain_abstention": {
        "en": "Clinical Boundary Policy: This query appears to be outside the supported medical pharmacology domain. Clinical Decision Support cannot provide non-medical advice.",
        "hi": "चिकित्सीय सीमा नीति: यह प्रश्न समर्थित मेडिकल फार्माकोलॉजी डोमेन के बाहर प्रतीत होता है। यह प्रणाली गैर-चिकित्सीय सलाह प्रदान नहीं कर सकती।",
        "mr": "वैद्यकीय मर्यादा धोरण: हा प्रश्न समर्थित वैद्यकीय औषधनिर्माण क्षेत्राबाहेरील वाटतो. ही प्रणाली गैर-वैद्यकीय सल्ला देऊ शकत नाही.",
        "gu": "ક્લિનિકલ સીમા નીતિ: આ પ્રશ્ન સમર્થિત તબીબી ફાર્માકોલોજી ડોમેનની બહાર જણાય છે. ક્લિનિકલ ડિસિઝન સપોર્ટ બિન-તબીબી સલાહ આપી શકતું નથી.",
    },

    # -------------------------------------------------------------------------
    # 5. GROUNDING VERIFICATION FAILURE
    # -------------------------------------------------------------------------
    "verification_failure_withheld": {
        "en": (
            "Clinical Safety Withholding: The generated response could not be fully grounded against verified medical monographs. "
            "To uphold clinical safety, unverified statements have been safely withheld fail-closed."
        ),
        "hi": (
            "चिकित्सीय सुरक्षा अवरोध: उत्पन्न किया गया उत्तर सत्यापित मेडिकल मोनोग्राफ द्वारा पूरी तरह प्रमाणित नहीं हो सका। "
            "रोगी सुरक्षा बनाए रखने के लिए अप्रमाणित दावों को सुरक्षित रूप से रोक दिया गया है।"
        ),
        "mr": (
            "वैद्यकीय सुरक्षितता निर्बंध: तयार केलेले उत्तर अधिकृत वैद्यकीय पुराव्यांशी पूर्णपणे सुसंगत सिद्ध होऊ शकले नाही. "
            "रुग्ण सुरक्षिततेसाठी असत्यापित माहिती सुरक्षितपणे रोखून ठेवली गेली आहे."
        ),
        "gu": (
            "ક્લિનિકલ સલામતી સંયમ: ઉત્પન્ન થયેલ જવાબ ચકાસાયેલ તબીબી મોનોગ્રાફ્સ સાથે સંપૂર્ણપણે આધારિત સાબિત થઈ શક્યો નથી. "
            "દર્દીની સલામતી જાળવવા માટે અપ્રમાણિત દાવાઓ સુરક્ષિત રીતે અટકાવવામાં આવ્યા છે."
        ),
    },

    # -------------------------------------------------------------------------
    # 6. PHYSICIAN CONSULTATION DISCLAIMER
    # -------------------------------------------------------------------------
    "physician_consultation_required": {
        "en": "CLINICAL GUIDANCE: Please consult your treating physician or licensed healthcare provider for individualized diagnosis and prescription advice.",
        "hi": "चिकित्सीय मार्गदर्शन: व्यक्तिगत निदान और दवा के पर्चे की सलाह के लिए कृपया अपने उपचार करने वाले चिकित्सक या योग्य डॉक्टर से परामर्श लें।",
        "mr": "वैद्यकीय मार्गदर्शन: वैयक्तिक निदान आणि औषधोपचाराच्या सल्ल्यासाठी कृपया आपल्या तपासणाऱ्या डॉक्टरांचा किंवा तज्ज्ञांचा सल्ला घ्या.",
        "gu": "ક્લિનિકલ માર્ગદર્શન: કૃપા કરીને વ્યક્તિગત નિદાન અને પ્રિસ્ક્રિપ્શન સલાહ માટે તમારા ડૉક્ટર અથવા યોગ્ય આરોગ્યસંભાળ પ્રદાતાની સલાહ લો.",
    },

    # -------------------------------------------------------------------------
    # 7. PATIENT EDUCATIONAL DISCLAIMER
    # -------------------------------------------------------------------------
    "patient_educational_disclaimer": {
        "en": (
            "\n\n---\n*Notice for Patients: This information is for general educational purposes and is not a substitute for advice from your healthcare professional. "
            "Do not stop, start, or alter your medication dose without explicit instructions from your doctor.*"
        ),
        "hi": (
            "\n\n---\n*मरीजों के लिए सूचना: यह जानकारी सामान्य शैक्षिक उद्देश्य के लिए है और आपके डॉक्टर की व्यक्तिगत सलाह का विकल्प नहीं है। "
            "अपने डॉक्टर के स्पष्ट निर्देश के बिना अपनी दवा की खुराक न बदलें, न बंद करें और न ही शुरू करें।*"
        ),
        "mr": (
            "\n\n---\n*रुग्णांसाठी सूचना: ही माहिती सर्वसाधारण शैक्षणिक उद्देशासाठी आहे आणि डॉक्टरांच्या वैयक्तिक सल्ल्याचा पर्याय नाही. "
            "आपल्या डॉक्टरांच्या स्पष्ट सल्ल्याशिवाय औषधांचा डोस बदलू नका, बंद करू नका किंवा सुरू करू नका.*"
        ),
        "gu": (
            "\n\n---\n*દર્દીઓ માટે સૂચના: આ માહિતી સામાન્ય શૈક્ષણિક હેતુ માટે છે અને તમારા ડૉક્ટરની વ્યક્તિગત સલાહનો વિકલ્પ નથી. "
            "તમારા ડૉક્ટરના સ્પષ્ટ નિર્દેશ વિના તમારી દવાનો ડોઝ બદલશો નહીં, બંધ કરશો નહીં અથવા શરૂ કરશો નહીં.*"
        ),
    },
    # -------------------------------------------------------------------------
    # 8. CONVERSATIONAL GREETING & ACKNOWLEDGEMENT
    # -------------------------------------------------------------------------
    "conversational_greeting": {
        "en": (
            "Hello! I am your Post-Discharge Care Assistant. I can help answer questions about your "
            "discharge instructions, prescribed medications, follow-up schedule, or recovery warning signs. "
            "How can I help you today?"
        ),
        "hi": (
            "नमस्ते! मैं आपका पोस्ट-डिस्चार्ज केयर असिस्टेंट हूँ। मैं आपके डिस्चार्ज निर्देशों, निर्धारित दवाओं, "
            "फॉलो-अप शेड्यूल या रिकवरी चेतावनी संकेतों के बारे में सवालों के जवाब देने में मदद कर सकता हूँ। "
            "आज मैं आपकी क्या मदद कर सकता हूँ?"
        ),
        "mr": (
            "नमस्कार! मी तुमचा पोस्ट-डिस्चार्ज केअर असिस्टंट आहे. मी तुमच्या डिस्चार्ज सूचना, लिहून दिलेली औषधे, "
            "फॉलो-अप वेळापत्रक किंवा रिकव्हरी चेतावणी चिन्हांबद्दलच्या प्रश्नांची उत्तरे देण्यास मदत करू शकतो. "
            "आज मी तुम्हाला कशी मदत करू शकतो?"
        ),
        "gu": (
            "નમસ્તે! હું તમારો પોસ્ટ-ડિસ્ચાર્જ કેર આસિસ્ટન્ટ છું. હું તમારા ડિસ્ચાર્જ સૂચનાઓ, સૂચવેલ દવાઓ, "
            "ફોલો-અપ શેડ્યૂલ અથવા રિકવરી ચેતવણી ચિહ્નો વિશેના પ્રશ્નોના જવાબ આપવામાં મદદ કરી શકું છું. "
            "આજે હું તમને કેવી રીતે મદદ કરી શકું?"
        ),
    },
    "conversational_acknowledgement": {
        "en": (
            "You're welcome! Please let me know if you have any questions about your medications, "
            "recovery instructions, or follow-up schedule."
        ),
        "hi": (
            "आपका स्वागत है! यदि आपके पास अपनी दवाओं, रिकवरी निर्देशों या फॉलो-अप शेड्यूल के बारे में कोई प्रश्न हैं, "
            "तो कृपया मुझे बताएं।"
        ),
        "mr": (
            "आपले स्वागत आहे! आपल्या औषधांबद्दल, रिकव्हरी सूचनांबद्दल किंवा फॉलो-अप वेळापत्रकाबद्दल काही प्रश्न असल्यास "
            "कृपया मला विचारा."
        ),
        "gu": (
            "આપનું સ્વાગત છે! જો તમને તમારી દવાઓ, રિકવરી સૂચનાઓ અથવા ફોલો-અપ શેડ્યૂલ વિશે કોઈ પ્રશ્નો હોય, "
            "તો કૃપા કરીને મને પૂછો."
        ),
    },
}


def get_localized_safety_alert(key: str, lang: str = "en", **kwargs) -> str:
    """Retrieves a safety-critical template in target language, falling back to English."""
    norm_lang = normalize_language_code(lang)
    template_group = SAFETY_TEMPLATES.get(key, {})
    text = template_group.get(norm_lang) or template_group.get("en", "")
    if kwargs:
        try:
            return text.format(**kwargs)
        except Exception:
            return text
    return text


def get_localized_emergency_guidance(lang: str = "en") -> str:
    """Returns authoritative emergency guidance in target language."""
    return get_localized_safety_alert("emergency_guidance", lang)


def get_conversational_greeting(lang: str = "en") -> str:
    """Returns friendly, localized post-discharge assistant greeting."""
    return get_localized_safety_alert("conversational_greeting", lang)


def get_conversational_acknowledgement(lang: str = "en") -> str:
    """Returns friendly, localized post-discharge assistant acknowledgement."""
    return get_localized_safety_alert("conversational_acknowledgement", lang)


def get_localized_interaction_alert(drug_a: str, drug_b: str, severity: str, clinical_action: str, lang: str = "en") -> Dict[str, str]:
    """
    Constructs a localized drug-drug interaction alert while strictly preserving
    the exact generic drug names, severity level, and clinical action.
    """
    norm_lang = normalize_language_code(lang)
    
    if norm_lang == "hi":
        return {
            "title": f"ड्रग इंटरैक्शन चेतावनी ({severity.upper()}): {drug_a} + {drug_b}",
            "warning": f"{drug_a} और {drug_b} के बीच संभावित {severity} परस्पर क्रिया (इंटरैक्शन) पाई गई है।",
            "action": f"अनुशंसित चिकित्सीय कदम: {clinical_action}",
            "disclaimer": "अपने चिकित्सक से परामर्श किए बिना इन दवाओं को एक साथ न लें।"
        }
    elif norm_lang == "mr":
        return {
            "title": f"औषध परस्परसंवाद इशारा ({severity.upper()}): {drug_a} + {drug_b}",
            "warning": f"{drug_a} आणि {drug_b} यांच्यामध्ये संभाव्य {severity} दुष्परिणाम/इंटरॅक्शन आढळली आहे.",
            "action": f"शिफारस केलेली वैद्यकीय कृती: {clinical_action}",
            "disclaimer": "आपल्या डॉक्टरांच्या सल्ल्याशिवाय ही औषधे एकत्र घेऊ नका."
        }
    elif norm_lang == "gu":
        return {
            "title": f"દવા ક્રિયાપ્રતિક્રિયા ચેતવણી ({severity.upper()}): {drug_a} + {drug_b}",
            "warning": f"{drug_a} અને {drug_b} વચ્ચે સંભવિત {severity} ક્રિયાપ્રતિક્રિયા (ઇન્ટરેક્શન) જણાઈ છે.",
            "action": f"ભલામણ કરેલ ક્લિનિકલ પગલું: {clinical_action}",
            "disclaimer": "તમારા ડૉક્ટરની સલાહ લીધા વિના આ દવાઓ સાથે ન લો."
        }
    else:
        return {
            "title": f"Drug Interaction Alert ({severity.upper()}): {drug_a} + {drug_b}",
            "warning": f"Potential {severity} interaction detected between {drug_a} and {drug_b}.",
            "action": f"Recommended Clinical Action: {clinical_action}",
            "disclaimer": "Do not co-administer without specialist clinical oversight."
        }
