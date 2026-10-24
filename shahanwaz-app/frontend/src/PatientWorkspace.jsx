import { cloneElement, isValidElement, useEffect, useState } from "react";

// PATIENT PORTAL LANGUAGE FEATURE V2
const PATIENT_TRANSLATIONS = {
  hi: {
    "Patient portal": "मरीज़ पोर्टल", "PATIENT PORTAL": "मरीज़ पोर्टल",
    "Patient account": "मरीज़ खाता", "YOUR WORKSPACE": "आपका कार्यक्षेत्र",
    "Need assistance?": "सहायता चाहिए?",
    "Contact your healthcare provider for account or care questions.": "खाते या देखभाल से जुड़े सवालों के लिए अपने स्वास्थ्य सेवा प्रदाता से संपर्क करें।",
    "Logout": "लॉग आउट", "Secure session": "सुरक्षित सत्र",
    "Unable to load this section": "यह अनुभाग लोड नहीं हो सका",
    "Retry": "फिर से प्रयास करें", "Loading your information…": "आपकी जानकारी लोड हो रही है…",
    "For emergencies, contact local emergency services.": "आपात स्थिति में स्थानीय आपातकालीन सेवाओं से संपर्क करें।",
    "Connected healthcare": "जुड़ी हुई स्वास्थ्य सेवाएँ",
    "YOUR PERSONAL HEALTH SPACE": "आपका व्यक्तिगत स्वास्थ्य क्षेत्र",
    "Your health overview": "आपके स्वास्थ्य का अवलोकन",
    "AT A GLANCE": "एक नज़र में", "YOUR CARE": "आपकी देखभाल",
    "Quick access": "त्वरित पहुँच",
    "RECOVERY & FOLLOW-UP": "स्वास्थ्य लाभ और अनुवर्ती देखभाल",
    "Post-discharge care": "डिस्चार्ज के बाद की देखभाल",
    "Review the discharge information and aftercare guidance recorded by your healthcare team.": "अपनी स्वास्थ्य टीम द्वारा दर्ज डिस्चार्ज जानकारी और आगे की देखभाल के निर्देश देखें।",
    "MEDICATIONS": "दवाएँ", "My prescription": "मेरी दवाएँ",
    "Review prescription records linked to your patient profile.": "अपने मरीज़ प्रोफ़ाइल से जुड़े दवा के रिकॉर्ड देखें।",
    "PERSONAL HEALTH SUPPORT": "व्यक्तिगत स्वास्थ्य सहायता",
    "AI Care Assistant": "AI स्वास्थ्य सहायक",
    "Ask questions about your discharge instructions and documented care.": "डिस्चार्ज निर्देशों और दर्ज देखभाल के बारे में सवाल पूछें।",
    "YOUR HEALTH INFORMATION": "आपकी स्वास्थ्य जानकारी",
    "Medical history": "चिकित्सा इतिहास",
    "Medical-history records associated with your signed-in patient account.": "आपके मरीज़ खाते से जुड़े चिकित्सा इतिहास के रिकॉर्ड।",
    "YOUR CARE TEAM": "आपकी देखभाल टीम",
    "Post-discharge chat": "डिस्चार्ज के बाद चैट",
    "Use this space for non-emergency follow-up questions about your discharge and recovery.": "डिस्चार्ज और स्वास्थ्य लाभ से जुड़े गैर-आपातकालीन सवाल यहाँ पूछें।",
    "This chat is not for emergencies. Seek urgent medical help for emergency symptoms.": "यह चैट आपात स्थिति के लिए नहीं है। आपातकालीन लक्षणों में तुरंत चिकित्सा सहायता लें।",
    "Overview": "अवलोकन", "Dashboard": "डैशबोर्ड", "Home": "होम",
    "Appointments": "अपॉइंटमेंट", "Post-Discharge Chat": "डिस्चार्ज के बाद चैट",
    "My Prescription": "मेरी दवाएँ", "Medical History": "चिकित्सा इतिहास",
    "Care Team": "देखभाल टीम", "My Profile": "मेरी प्रोफ़ाइल",
    "Upcoming appointments": "आगामी अपॉइंटमेंट", "Recent appointments": "हाल के अपॉइंटमेंट",
    "Recent prescriptions": "हाल के नुस्खे", "View all": "सभी देखें",
    "View details": "विवरण देखें", "Refresh": "रीफ़्रेश करें",
    "Loading...": "लोड हो रहा है...", "Save changes": "बदलाव सहेजें",
    "Save": "सहेजें", "Cancel": "रद्द करें", "Close": "बंद करें",
    "Back": "वापस", "Next": "आगे", "Search": "खोजें",
    "Send": "भेजें", "Send message": "संदेश भेजें", "Submit": "जमा करें",
    "Yes": "हाँ", "No": "नहीं", "Pending": "लंबित",
    "Scheduled": "निर्धारित", "Completed": "पूरा हुआ", "Cancelled": "रद्द",
    "In progress": "जारी है", "Active": "सक्रिय", "Confirmed": "पुष्टि की गई",
    "Patient": "मरीज़", "Doctor": "डॉक्टर", "Date": "तारीख",
    "Time": "समय", "Status": "स्थिति", "Reason": "कारण",
    "Blood group": "ब्लड ग्रुप", "Date of birth": "जन्म तिथि",
    "Gender": "लिंग", "Phone": "फ़ोन", "Email": "ईमेल", "Address": "पता",
    "Emergency contact": "आपातकालीन संपर्क", "Allergies": "एलर्जी",
    "Diagnosis": "निदान", "Medication": "दवा", "Dosage": "खुराक",
    "Instructions": "निर्देश", "Prescription": "नुस्खा", "Notes": "नोट्स",
    "Language": "भाषा", "View": "देखें", "Details": "विवरण",
    "No data available": "कोई डेटा उपलब्ध नहीं", "No records found": "कोई रिकॉर्ड नहीं मिला",
    "Not available": "उपलब्ध नहीं", "Not provided": "जानकारी नहीं दी गई",
    "None recorded": "कोई जानकारी दर्ज नहीं", "Ask a question": "सवाल पूछें",
    "Type your message...": "अपना संदेश लिखें...", "Type your question...": "अपना सवाल लिखें...",
    "Good morning": "सुप्रभात", "Good afternoon": "नमस्कार", "Good evening": "शुभ संध्या"
  },
  gu: {
    "Patient portal": "દર્દી પોર્ટલ", "PATIENT PORTAL": "દર્દી પોર્ટલ",
    "Patient account": "દર્દી ખાતું", "YOUR WORKSPACE": "તમારું કાર્યક્ષેત્ર",
    "Need assistance?": "મદદ જોઈએ છે?",
    "Contact your healthcare provider for account or care questions.": "ખાતા અથવા સારવાર સંબંધિત પ્રશ્નો માટે તમારા આરોગ્ય સેવા પ્રદાતાનો સંપર્ક કરો.",
    "Logout": "લૉગ આઉટ", "Secure session": "સુરક્ષિત સત્ર",
    "Unable to load this section": "આ વિભાગ લોડ થઈ શક્યો નથી",
    "Retry": "ફરી પ્રયાસ કરો", "Loading your information…": "તમારી માહિતી લોડ થઈ રહી છે…",
    "For emergencies, contact local emergency services.": "કટોકટીમાં સ્થાનિક કટોકટી સેવાઓનો સંપર્ક કરો.",
    "Connected healthcare": "જોડાયેલી આરોગ્ય સેવાઓ",
    "YOUR PERSONAL HEALTH SPACE": "તમારું વ્યક્તિગત આરોગ્ય ક્ષેત્ર",
    "Your health overview": "તમારા આરોગ્યની ઝાંખી",
    "AT A GLANCE": "એક નજરમાં", "YOUR CARE": "તમારી સંભાળ",
    "Quick access": "ઝડપી ઍક્સેસ",
    "RECOVERY & FOLLOW-UP": "સ્વસ્થતા અને અનુસરણ",
    "Post-discharge care": "ડિસ્ચાર્જ પછીની સંભાળ",
    "Review the discharge information and aftercare guidance recorded by your healthcare team.": "તમારી આરોગ્ય ટીમ દ્વારા નોંધાયેલી ડિસ્ચાર્જ માહિતી અને સંભાળની સૂચનાઓ જુઓ.",
    "MEDICATIONS": "દવાઓ", "My prescription": "મારી દવાઓ",
    "Review prescription records linked to your patient profile.": "તમારી દર્દી પ્રોફાઇલ સાથે જોડાયેલા દવાના રેકોર્ડ જુઓ.",
    "PERSONAL HEALTH SUPPORT": "વ્યક્તિગત આરોગ્ય સહાય",
    "AI Care Assistant": "AI આરોગ્ય સહાયક",
    "Ask questions about your discharge instructions and documented care.": "ડિસ્ચાર્જની સૂચનાઓ અને નોંધાયેલી સંભાળ વિશે પ્રશ્નો પૂછો.",
    "YOUR HEALTH INFORMATION": "તમારી આરોગ્ય માહિતી",
    "Medical history": "તબીબી ઇતિહાસ",
    "Medical-history records associated with your signed-in patient account.": "તમારા દર્દી ખાતા સાથે જોડાયેલા તબીબી ઇતિહાસના રેકોર્ડ.",
    "YOUR CARE TEAM": "તમારી સંભાળ ટીમ",
    "Post-discharge chat": "ડિસ્ચાર્જ પછીની ચેટ",
    "Use this space for non-emergency follow-up questions about your discharge and recovery.": "ડિસ્ચાર્જ અને સ્વસ્થતા વિશેના બિન-કટોકટી પ્રશ્નો અહીં પૂછો.",
    "This chat is not for emergencies. Seek urgent medical help for emergency symptoms.": "આ ચેટ કટોકટી માટે નથી. કટોકટીના લક્ષણો હોય તો તરત તબીબી મદદ લો.",
    "Overview": "ઝાંખી", "Dashboard": "ડેશબોર્ડ", "Home": "હોમ",
    "Appointments": "મુલાકાતો", "Post-Discharge Chat": "ડિસ્ચાર્જ પછીની ચેટ",
    "My Prescription": "મારી દવાઓ", "Medical History": "તબીબી ઇતિહાસ",
    "Care Team": "સંભાળ ટીમ", "My Profile": "મારી પ્રોફાઇલ",
    "Upcoming appointments": "આગામી મુલાકાતો", "Recent appointments": "તાજેતરની મુલાકાતો",
    "Recent prescriptions": "તાજેતરના પ્રિસ્ક્રિપ્શન", "View all": "બધું જુઓ",
    "View details": "વિગતો જુઓ", "Refresh": "ફરીથી લોડ કરો",
    "Loading...": "લોડ થઈ રહ્યું છે...", "Save changes": "ફેરફારો સાચવો",
    "Save": "સાચવો", "Cancel": "રદ કરો", "Close": "બંધ કરો",
    "Back": "પાછા", "Next": "આગળ", "Search": "શોધો",
    "Send": "મોકલો", "Send message": "સંદેશ મોકલો", "Submit": "સબમિટ કરો",
    "Yes": "હા", "No": "ના", "Pending": "બાકી", "Scheduled": "નક્કી થયેલ",
    "Completed": "પૂર્ણ", "Cancelled": "રદ", "In progress": "ચાલુ છે",
    "Active": "સક્રિય", "Confirmed": "પુષ્ટિ થયેલ", "Patient": "દર્દી",
    "Doctor": "ડૉક્ટર", "Date": "તારીખ", "Time": "સમય", "Status": "સ્થિતિ",
    "Reason": "કારણ", "Blood group": "બ્લડ ગ્રુપ", "Date of birth": "જન્મ તારીખ",
    "Gender": "લિંગ", "Phone": "ફોન", "Email": "ઈમેઇલ", "Address": "સરનામું",
    "Emergency contact": "કટોકટી સંપર્ક", "Allergies": "એલર્જી", "Diagnosis": "નિદાન",
    "Medication": "દવા", "Dosage": "ડોઝ", "Instructions": "સૂચનાઓ",
    "Prescription": "પ્રિસ્ક્રિપ્શન", "Notes": "નોંધો", "Language": "ભાષા",
    "View": "જુઓ", "Details": "વિગતો", "No data available": "કોઈ ડેટા ઉપલબ્ધ નથી",
    "No records found": "કોઈ રેકોર્ડ મળ્યો નથી", "Not available": "ઉપલબ્ધ નથી",
    "Not provided": "માહિતી આપવામાં આવી નથી", "None recorded": "કોઈ માહિતી નોંધાઈ નથી",
    "Ask a question": "પ્રશ્ન પૂછો", "Type your message...": "તમારો સંદેશ લખો...",
    "Type your question...": "તમારો પ્રશ્ન લખો...", "Good morning": "સુપ્રભાત",
    "Good afternoon": "નમસ્તે", "Good evening": "શુભ સાંજ"
  },
  mr: {
    "Patient portal": "रुग्ण पोर्टल", "PATIENT PORTAL": "रुग्ण पोर्टल",
    "Patient account": "रुग्ण खाते", "YOUR WORKSPACE": "तुमचे कार्यक्षेत्र",
    "Need assistance?": "मदत हवी आहे?",
    "Contact your healthcare provider for account or care questions.": "खाते किंवा उपचारांसंबंधी प्रश्नांसाठी तुमच्या आरोग्य सेवा प्रदात्याशी संपर्क साधा.",
    "Logout": "लॉग आउट", "Secure session": "सुरक्षित सत्र",
    "Unable to load this section": "हा विभाग लोड होऊ शकला नाही",
    "Retry": "पुन्हा प्रयत्न करा", "Loading your information…": "तुमची माहिती लोड होत आहे…",
    "For emergencies, contact local emergency services.": "आपत्कालीन परिस्थितीत स्थानिक आपत्कालीन सेवांशी संपर्क साधा.",
    "Connected healthcare": "जोडलेल्या आरोग्य सेवा",
    "YOUR PERSONAL HEALTH SPACE": "तुमचे वैयक्तिक आरोग्य क्षेत्र",
    "Your health overview": "तुमच्या आरोग्याचा आढावा",
    "AT A GLANCE": "एका दृष्टीक्षेपात", "YOUR CARE": "तुमची काळजी",
    "Quick access": "जलद प्रवेश",
    "RECOVERY & FOLLOW-UP": "आरोग्य सुधारणा आणि पाठपुरावा",
    "Post-discharge care": "डिस्चार्जनंतरची काळजी",
    "Review the discharge information and aftercare guidance recorded by your healthcare team.": "तुमच्या आरोग्य पथकाने नोंदवलेली डिस्चार्ज माहिती आणि पुढील काळजीच्या सूचना पहा.",
    "MEDICATIONS": "औषधे", "My prescription": "माझी औषधे",
    "Review prescription records linked to your patient profile.": "तुमच्या रुग्ण प्रोफाइलशी संबंधित औषधांच्या नोंदी पहा.",
    "PERSONAL HEALTH SUPPORT": "वैयक्तिक आरोग्य सहाय्य",
    "AI Care Assistant": "AI आरोग्य सहाय्यक",
    "Ask questions about your discharge instructions and documented care.": "डिस्चार्जच्या सूचना आणि नोंदवलेल्या काळजीबद्दल प्रश्न विचारा.",
    "YOUR HEALTH INFORMATION": "तुमची आरोग्य माहिती",
    "Medical history": "वैद्यकीय इतिहास",
    "Medical-history records associated with your signed-in patient account.": "तुमच्या रुग्ण खात्याशी संबंधित वैद्यकीय इतिहासाच्या नोंदी.",
    "YOUR CARE TEAM": "तुमचे काळजी पथक",
    "Post-discharge chat": "डिस्चार्जनंतरची चॅट",
    "Use this space for non-emergency follow-up questions about your discharge and recovery.": "डिस्चार्ज आणि आरोग्य सुधारण्यासंबंधी गैर-आपत्कालीन प्रश्न येथे विचारा.",
    "This chat is not for emergencies. Seek urgent medical help for emergency symptoms.": "ही चॅट आपत्कालीन परिस्थितीसाठी नाही. आपत्कालीन लक्षणे असल्यास त्वरित वैद्यकीय मदत घ्या.",
    "Overview": "आढावा", "Dashboard": "डॅशबोर्ड", "Home": "मुख्यपृष्ठ",
    "Appointments": "भेटी", "Post-Discharge Chat": "डिस्चार्जनंतरची चॅट",
    "My Prescription": "माझी औषधे", "Medical History": "वैद्यकीय इतिहास",
    "Care Team": "काळजी पथक", "My Profile": "माझे प्रोफाइल",
    "Upcoming appointments": "आगामी भेटी", "Recent appointments": "अलीकडील भेटी",
    "Recent prescriptions": "अलीकडील औषधपत्रे", "View all": "सर्व पहा",
    "View details": "तपशील पहा", "Refresh": "पुन्हा लोड करा",
    "Loading...": "लोड होत आहे...", "Save changes": "बदल जतन करा",
    "Save": "जतन करा", "Cancel": "रद्द करा", "Close": "बंद करा",
    "Back": "मागे", "Next": "पुढे", "Search": "शोधा",
    "Send": "पाठवा", "Send message": "संदेश पाठवा", "Submit": "सबमिट करा",
    "Yes": "होय", "No": "नाही", "Pending": "प्रलंबित", "Scheduled": "नियोजित",
    "Completed": "पूर्ण", "Cancelled": "रद्द", "In progress": "सुरू आहे",
    "Active": "सक्रिय", "Confirmed": "पुष्टी केलेले", "Patient": "रुग्ण",
    "Doctor": "डॉक्टर", "Date": "तारीख", "Time": "वेळ", "Status": "स्थिती",
    "Reason": "कारण", "Blood group": "रक्तगट", "Date of birth": "जन्मतारीख",
    "Gender": "लिंग", "Phone": "फोन", "Email": "ईमेल", "Address": "पत्ता",
    "Emergency contact": "आपत्कालीन संपर्क", "Allergies": "अॅलर्जी",
    "Diagnosis": "निदान", "Medication": "औषध", "Dosage": "औषधाचे प्रमाण",
    "Instructions": "सूचना", "Prescription": "औषधपत्र", "Notes": "नोंदी",
    "Language": "भाषा", "View": "पहा", "Details": "तपशील",
    "No data available": "डेटा उपलब्ध नाही", "No records found": "कोणतीही नोंद आढळली नाही",
    "Not available": "उपलब्ध नाही", "Not provided": "माहिती दिलेली नाही",
    "None recorded": "कोणतीही माहिती नोंदलेली नाही",
    "Ask a question": "प्रश्न विचारा", "Type your message...": "तुमचा संदेश लिहा...",
    "Type your question...": "तुमचा प्रश्न लिहा...", "Good morning": "शुभ सकाळ",
    "Good afternoon": "नमस्कार", "Good evening": "शुभ संध्याकाळ"
  }
};

// PATIENT TRANSLATION COVERAGE FIX V3
const PATIENT_TRANSLATION_OVERRIDES = {
  hi: {
    "My Dashboard": "मेरा डैशबोर्ड",
    "Hello,": "नमस्ते,",
    "Dashboard": "डैशबोर्ड",
    "Post-Discharge Care": "डिस्चार्ज के बाद की देखभाल",
    "Post-discharge care": "डिस्चार्ज के बाद की देखभाल",
    "Discharge records": "डिस्चार्ज रिकॉर्ड",
    "Prescriptions": "दवाएँ",
    "Care messages": "देखभाल संदेश",
    "Your recovery records": "आपकी रिकवरी के रिकॉर्ड",
    "Prescriptions on file": "दर्ज दवाएँ",
    "Records linked to you": "आपसे जुड़े रिकॉर्ड",
    "Post-discharge messages": "डिस्चार्ज के बाद के संदेश",
    "Your health overview": "आपके स्वास्थ्य का अवलोकन",
    "Keep track of your recovery, prescriptions and care-team updates in one place.": "अपनी रिकवरी, दवाओं और देखभाल टीम के अपडेट एक ही जगह देखें।",
    "Ask questions about your discharge instructions and documented care.": "अपने डिस्चार्ज निर्देशों और दर्ज देखभाल के बारे में सवाल पूछें।",
    "For emergencies, contact emergency services immediately.": "आपात स्थिति में तुरंत आपातकालीन सेवाओं से संपर्क करें।",
    "Refresh": "रीफ़्रेश करें",
    "AI Care Assistant": "AI स्वास्थ्य सहायक",
    "Medical history": "चिकित्सा इतिहास",
    "My medications": "मेरी दवाएँ"
  },
  gu: {
    "My Dashboard": "મારું ડેશબોર્ડ",
    "Hello,": "નમસ્તે,",
    "Dashboard": "ડેશબોર્ડ",
    "Post-Discharge Care": "ડિસ્ચાર્જ પછીની સંભાળ",
    "Post-discharge care": "ડિસ્ચાર્જ પછીની સંભાળ",
    "Discharge records": "ડિસ્ચાર્જ રેકોર્ડ",
    "Prescriptions": "પ્રિસ્ક્રિપ્શન",
    "Care messages": "સંભાળ સંદેશાઓ",
    "Your recovery records": "તમારી સ્વસ્થતાના રેકોર્ડ",
    "Prescriptions on file": "નોંધાયેલ પ્રિસ્ક્રિપ્શન",
    "Records linked to you": "તમારી સાથે જોડાયેલા રેકોર્ડ",
    "Post-discharge messages": "ડિસ્ચાર્જ પછીના સંદેશાઓ",
    "Your health overview": "તમારા આરોગ્યની ઝાંખી",
    "Keep track of your recovery, prescriptions and care-team updates in one place.": "તમારી સ્વસ્થતા, દવાઓ અને સંભાળ ટીમના અપડેટ્સ એક જ જગ્યાએ જુઓ.",
    "Ask questions about your discharge instructions and documented care.": "ડિસ્ચાર્જની સૂચનાઓ અને નોંધાયેલી સંભાળ વિશે પ્રશ્નો પૂછો.",
    "For emergencies, contact emergency services immediately.": "કટોકટીમાં તરત જ કટોકટી સેવાઓનો સંપર્ક કરો.",
    "Refresh": "ફરીથી લોડ કરો",
    "AI Care Assistant": "AI આરોગ્ય સહાયક",
    "Medical history": "તબીબી ઇતિહાસ",
    "My medications": "મારી દવાઓ"
  },
  mr: {
    "My Dashboard": "माझा डॅशबोर्ड",
    "Hello,": "नमस्कार,",
    "Dashboard": "डॅशबोर्ड",
    "Post-Discharge Care": "डिस्चार्जनंतरची काळजी",
    "Post-discharge care": "डिस्चार्जनंतरची काळजी",
    "Discharge records": "डिस्चार्ज नोंदी",
    "Prescriptions": "औषधपत्रे",
    "Care messages": "काळजीचे संदेश",
    "Your recovery records": "तुमच्या आरोग्य सुधारण्याच्या नोंदी",
    "Prescriptions on file": "नोंदवलेली औषधपत्रे",
    "Records linked to you": "तुमच्याशी संबंधित नोंदी",
    "Post-discharge messages": "डिस्चार्जनंतरचे संदेश",
    "Your health overview": "तुमच्या आरोग्याचा आढावा",
    "Keep track of your recovery, prescriptions and care-team updates in one place.": "तुमची प्रकृती सुधारणा, औषधे आणि काळजी पथकाचे अपडेट्स एकाच ठिकाणी पहा.",
    "Ask questions about your discharge instructions and documented care.": "डिस्चार्जच्या सूचना आणि नोंदवलेल्या काळजीबद्दल प्रश्न विचारा.",
    "For emergencies, contact emergency services immediately.": "आपत्कालीन परिस्थितीत त्वरित आपत्कालीन सेवांशी संपर्क साधा.",
    "Refresh": "पुन्हा लोड करा",
    "AI Care Assistant": "AI आरोग्य सहाय्यक",
    "Medical history": "वैद्यकीय इतिहास",
    "My medications": "माझी औषधे"
  }
};

const PATIENT_TRANSLATION_INLINE = {
  hi: {
    "Hello,": "नमस्ते,",
    "For emergencies, contact emergency services immediately.": "आपात स्थिति में तुरंत आपातकालीन सेवाओं से संपर्क करें।",
    "Ask questions about your discharge instructions and documented care.": "अपने डिस्चार्ज निर्देशों और दर्ज देखभाल के बारे में सवाल पूछें।",
    "Keep track of your recovery, prescriptions and care-team updates in one place.": "अपनी रिकवरी, दवाओं और देखभाल टीम के अपडेट एक ही जगह देखें।"
  },
  gu: {
    "Hello,": "નમસ્તે,",
    "For emergencies, contact emergency services immediately.": "કટોકટીમાં તરત જ કટોકટી સેવાઓનો સંપર્ક કરો.",
    "Ask questions about your discharge instructions and documented care.": "ડિસ્ચાર્જની સૂચનાઓ અને નોંધાયેલી સંભાળ વિશે પ્રશ્નો પૂછો.",
    "Keep track of your recovery, prescriptions and care-team updates in one place.": "તમારી સ્વસ્થતા, દવાઓ અને સંભાળ ટીમના અપડેટ્સ એક જ જગ્યાએ જુઓ."
  },
  mr: {
    "Hello,": "नमस्कार,",
    "For emergencies, contact emergency services immediately.": "आपत्कालीन परिस्थितीत त्वरित आपत्कालीन सेवांशी संपर्क साधा.",
    "Ask questions about your discharge instructions and documented care.": "डिस्चार्जच्या सूचना आणि नोंदवलेल्या काळजीबद्दल प्रश्न विचारा.",
    "Keep track of your recovery, prescriptions and care-team updates in one place.": "तुमची प्रकृती सुधारणा, औषधे आणि काळजी पथकाचे अपडेट्स एकाच ठिकाणी पहा."
  }
};
// PATIENT TRANSLATION COVERAGE FIX V3 END
function patientTranslateText(value, language) {
  if (typeof value !== "string" || !value.trim()) return value;

  const baseDictionary = PATIENT_TRANSLATIONS[language] || {};
  const overrides = PATIENT_TRANSLATION_OVERRIDES[language] || {};
  const dictionary = { ...baseDictionary, ...overrides };

  const leading = value.match(/^\s*/)?.[0] || "";
  const trailing = value.match(/\s*$/)?.[0] || "";
  const normalized = value.trim().replace(/\s+/g, " ");

  if (Object.prototype.hasOwnProperty.call(dictionary, normalized)) {
    return leading + dictionary[normalized] + trailing;
  }

  // Translate a small approved set of full phrases in compound text nodes.
  // This supports greetings with a dynamic patient name while preserving the name.
  const inline = PATIENT_TRANSLATION_INLINE[language] || {};
  let result = normalized;

  for (const source of Object.keys(inline).sort((a, b) => b.length - a.length)) {
    result = result.split(source).join(inline[source]);
  }

  return result === normalized ? value : leading + result + trailing;
}

function patientTranslateTree(node, language) {
  if (node === null || node === undefined || typeof node === "boolean") return node;
  if (typeof node === "string") return patientTranslateText(node, language);
  if (typeof node === "number") return node;
  if (Array.isArray(node)) return node.map((child) => patientTranslateTree(child, language));
  if (!isValidElement(node)) return node;

  const nextProps = {};
  const textProps = [
    "placeholder", "aria-label", "aria-description", "title", "alt",
    "label", "detail", "description", "note", "caption", "heading",
    "emptyLabel", "emptyText", "helperText", "subtitle"
  ];

  for (const propName of textProps) {
    if (typeof node.props[propName] === "string") {
      nextProps[propName] = patientTranslateText(node.props[propName], language);
    }
  }

  if (node.props.children !== undefined) {
    return cloneElement(node, nextProps, patientTranslateTree(node.props.children, language));
  }
  return cloneElement(node, nextProps);
}

function PatientPortalLanguageLayer({ language, children }) {
  return <>{patientTranslateTree(children, language)}</>;
}
// PATIENT PORTAL LANGUAGE FEATURE V2 END
function renderAssistantMarkdown(markdown) {
  // Normalize escaped Markdown markers before parsing them.
  const normalized = String(markdown ?? "").replace(/\\([*_])/g, "$1");
  const tokenPattern = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;

  return normalized.split(/\r?\n/).map((line, lineIndex) => {
    if (/^\s*---+\s*$/.test(line)) {
      return <hr className="patient-ai-markdown-rule" key={`rule-${lineIndex}`} />;
    }

    if (!line.trim()) {
      return (
        <div
          className="patient-ai-markdown-spacer"
          key={`space-${lineIndex}`}
          aria-hidden="true"
        />
      );
    }

    const bulletMatch = line.match(/^(\s*[•-]\s+)(.*)$/);
    const prefix = bulletMatch ? bulletMatch[1] : "";
    const content = bulletMatch ? bulletMatch[2] : line;

    const parts = content.split(tokenPattern).map((part, partIndex) => {
      if (
        part.startsWith("**") &&
        part.endsWith("**") &&
        part.length >= 4
      ) {
        return <strong key={partIndex}>{part.slice(2, -2)}</strong>;
      }

      if (
        part.startsWith("*") &&
        part.endsWith("*") &&
        part.length >= 3
      ) {
        return <em key={partIndex}>{part.slice(1, -1)}</em>;
      }

      return part;
    });

    return (
      <div
        className={`patient-ai-markdown-line${bulletMatch ? " patient-ai-markdown-bullet" : ""}`}
        key={`line-${lineIndex}`}
      >
        {prefix}
        {parts}
      </div>
    );
  });
}

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001"
).replace(/\/$/, "");

const navigation = [
  { id: "dashboard", label: "My Dashboard", symbol: "⌂" },
  { id: "care", label: "Post-Discharge Care", symbol: "♡" },
  { id: "chat", label: "Post-Discharge Chat", symbol: "▤" },
  { id: "assistant", label: "AI Care Assistant", symbol: "\u2728" },
  { id: "prescriptions", label: "My Prescription", symbol: "✚" },
  { id: "history", label: "Medical History", symbol: "▧" },
];

async function patientApi(path, options = {}) {
  const token = sessionStorage.getItem("unifiedHealthcareToken");

  if (!token) {
    throw new Error("Your session has expired. Please sign in again.");
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new Error(
      "Cannot reach the healthcare backend. Check that the API is running on port 5001."
    );
  }

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    throw new Error("Your session has expired. Please sign in again.");
  }
  if (!response.ok) {
    throw new Error(data.message || `Request failed (${response.status}).`);
  }
  return data;
}

function displayLabel(key) {
  return String(key)
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "Not provided";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function RecordCard({ record, index, kind }) {
  const [expanded, setExpanded] = useState(false);
  const entries = Object.entries(record || {}).filter(
    ([key, value]) =>
      !/password|token|secret|file_path|binary_data|blob_data|raw_content|base64/i.test(key) &&
      value !== null &&
      value !== undefined &&
      value !== ""
  );

  const headingKeys =
    kind === "prescription"
      ? ["prescription_name", "medicine_name", "title", "prescription_id", "diagnosis"]
      : kind === "discharge"
        ? ["discharge_date", "discharged_at", "title", "discharge_id", "diagnosis"]
        : ["condition", "diagnosis", "title", "record_type", "history_id"];

  const headingEntry = entries.find(([key]) =>
    headingKeys.includes(key.toLowerCase())
  );

  const title = headingEntry
    ? displayValue(headingEntry[1])
    : `${kind === "prescription" ? "Prescription" : kind === "discharge" ? "Discharge record" : "Medical record"} ${index + 1}`;

  return (
    <article className="patient-record-card" key={`${kind}-${index}`}>
      <div className="patient-record-heading">
        <div className={`patient-record-icon ${kind}`}>
          {kind === "prescription" ? "✚" : kind === "discharge" ? "♡" : "▧"}
        </div>
        <div className="patient-record-title">
          <h3>{title}</h3>
          <span>{displayLabel(kind)} · Record {index + 1}</span>
        </div>
      </div>
      <dl className="patient-record-fields">
        {entries.slice(0, expanded ? entries.length : 12).map(([key, value]) => (
          <div key={key} className="patient-record-field">
            <dt>{displayLabel(key)}</dt>
            <dd>{displayValue(value)}</dd>
          </div>
        ))}
      </dl>
      {entries.length > 12 && (
        <button
          type="button"
          className="patient-record-expand-button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Show fewer fields" : `Show all ${entries.length} fields`}
        </button>
      )}
    </article>
  );
}

function EmptyState({ symbol, title, description }) {
  return (
    <div className="patient-empty-state">
      <div className="patient-empty-symbol">{symbol}</div>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

function StatCard({ label, value, symbol, note, onClick }) {
  return (
    <article
      className={`patient-stat-card ${onClick ? "patient-stat-card-interactive" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      } : undefined}
    >
      <div className="patient-stat-top">
        <span>{label}</span>
        <span className="patient-stat-symbol">{symbol}</span>
      </div>
      <strong>{value ?? "—"}</strong>
      <p>{note}</p>
    </article>
  );
}

export default function PatientWorkspace({ user, onLogout }) {
  const [activeSection, setActiveSection] = useState("dashboard");
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const [recordSearch, setRecordSearch] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [discharges, setDischarges] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [history, setHistory] = useState([]);
  const [chatData, setChatData] = useState({ messages: [], doctor: null });
  const [contacts, setContacts] = useState([]);
  const [selectedContactId, setSelectedContactId] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const [assistantLanguage, setAssistantLanguage] = useState(() => {
    const saved = sessionStorage.getItem("patientAssistantLanguage") || "en";
    return ["en", "hi", "mr", "gu"].includes(saved) ? saved : "en";
  });
  // PATIENT LANGUAGE INDEPENDENT STATE FIX V1
  const [portalLanguage, setPortalLanguage] = useState(() => {
    const saved = sessionStorage.getItem("patientPortalLanguage") || "en";
    return ["en", "hi", "mr", "gu"].includes(saved) ? saved : "en";
  });
  const [assistantQuestion, setAssistantQuestion] = useState("");
  const [assistantMessages, setAssistantMessages] = useState([]);
  const [assistantSending, setAssistantSending] = useState(false);


  async function loadSection(section, quiet = false) {
    if (!quiet) setLoading(true);
    setPageError("");

    const endpoints = {
      dashboard: "/api/patient/dashboard",
      care: "/api/patient/discharges",
      chat: "/api/patient/chat",
      prescriptions: "/api/patient/prescriptions",
      history: "/api/patient/medical-history",
    };

    try {
      const requestPath =
        section === "chat" && selectedContactId
          ? `${endpoints[section]}?contactId=${encodeURIComponent(selectedContactId)}`
          : endpoints[section];
      const result = await patientApi(requestPath);

      if (section === "dashboard") setDashboard(result);
      if (section === "care") {
        setDischarges(Array.isArray(result.discharges) ? result.discharges : result.items || []);
      }
      if (section === "prescriptions") {
        setPrescriptions(Array.isArray(result.prescriptions) ? result.prescriptions : result.items || []);
      }
      if (section === "history") {
        setHistory(Array.isArray(result.records) ? result.records : result.items || []);
      }
      if (section === "chat") {
        const availableContacts = Array.isArray(result.contacts) ? result.contacts : [];
        setContacts(availableContacts);
        setChatData({
          messages: Array.isArray(result.messages) ? result.messages : [],
          doctor: result.contact || null,
        });

        if (!selectedContactId && availableContacts.length) {
          setSelectedContactId(String(availableContacts[0].user_id));
        }
      }
    } catch (error) {
      setPageError(error.message || "Unable to load this section.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => {
    if (activeSection === "assistant") return;
    loadSection(activeSection);
  }, [activeSection]);

  useEffect(() => {
    sessionStorage.setItem("patientAssistantLanguage", assistantLanguage);
  }, [assistantLanguage]);

  useEffect(() => {
    if (activeSection !== "chat") return undefined;
    const timer = window.setInterval(() => loadSection("chat", true), 15000);
    return () => window.clearInterval(timer);
  }, [activeSection]);

  async function sendMessage(event) {
    event.preventDefault();
    const text = message.trim();
    if (!text || sending) return;

    setSending(true);
    setPageError("");
    try {
      await patientApi("/api/patient/chat", {
        method: "POST",
        body: JSON.stringify({ message: text, recipientUserId: Number(selectedContactId) }),
      });
      setMessage("");
      await loadSection("chat", true);
    } catch (error) {
      setPageError(error.message || "Your message could not be sent.");
    } finally {
      setSending(false);
    }
  }


  async function submitAssistantQuestion(eventOrQuestion) {
    const isSuggestedQuestion = typeof eventOrQuestion === "string";
    if (!isSuggestedQuestion) eventOrQuestion.preventDefault();
    const question = (isSuggestedQuestion ? eventOrQuestion : assistantQuestion).trim();
    const language = assistantLanguage;

    if (!question || assistantSending) return;

    setAssistantSending(true);
    setAssistantQuestion("");
    setAssistantMessages(current => [
      ...current,
      {
        id: `patient-${Date.now()}`,
        role: "patient",
        text: question,
        language
      }
    ]);

    try {
      const result = await patientApi("/api/patient/assistant", {
        method: "POST",
        body: JSON.stringify({ question, language })
      });

      setAssistantMessages(current => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text: result.answer || "The assistant returned no answer.",
          language: result.language || language,
          sources: Array.isArray(result.sources) ? result.sources : [],
          verificationStatus: result.verification_status || "unknown",
          isGrounded: Boolean(result.is_grounded),
          isEmergency: Boolean(result.is_emergency),
          abstained: Boolean(result.abstained)
        }
      ]);
    } catch (error) {
      setAssistantMessages(current => [
        ...current,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          text: error.message || "The assistant could not process your question.",
          language,
          sources: [],
          isError: true
        }
      ]);
    } finally {
      setAssistantSending(false);
    }
  }

  const title = navigation.find((item) => item.id === activeSection)?.label || "My Dashboard";
  const stats = dashboard?.summary || {};
  const messages = chatData.messages || [];

  function selectSection(id) {
    setActiveSection(id);
    setRecordSearch("");
  }

  function filterRecords(records) {
    const term = recordSearch.trim().toLowerCase();
    if (!term) return records || [];
    return (records || []).filter((record) =>
      Object.entries(record || {}).some(([key, value]) => {
        if (/password|token|secret|file_path|binary_data|blob_data/i.test(key)) return false;
        const searchable = value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
        return searchable.toLowerCase().includes(term);
      })
    );
  }  function renderDashboard() {
    return (
      <>
        <section className="patient-welcome-banner">
          <div className="patient-welcome-copy">
            <span className="patient-eyebrow">YOUR PERSONAL HEALTH SPACE</span>
            <h2>Hello, {user.fullName?.split(" ")[0] || "there"}<span>.</span></h2>
            <p>Keep track of your recovery, prescriptions and care-team updates in one place.</p>
          </div>
          <div className="patient-welcome-art" aria-hidden="true">
            <span>✚</span>
            <i />
            <b />
          </div>
        </section>

        <div className="patient-section-heading">
          <div>
            <span className="patient-eyebrow">AT A GLANCE</span>
            <h2>Your health overview</h2>
          </div>
          <button className="patient-refresh-button" onClick={() => loadSection("dashboard")}>
            ↻ Refresh
          </button>
        </div>

        <div className="patient-stats-grid">
          <StatCard label="Discharge records" value={stats.dischargeCount ?? stats.discharge_count ?? "—"} symbol="♡" note="Your recovery records" onClick={() => selectSection("care")} />
          <StatCard label="Prescriptions" value={stats.prescriptionCount ?? stats.prescription_count ?? "—"} symbol="✚" note="Prescriptions on file" onClick={() => selectSection("prescriptions")} />
          <StatCard label="Medical history" value={stats.historyCount ?? stats.history_count ?? "—"} symbol="▧" note="Records linked to you" onClick={() => selectSection("history")} />
          <StatCard label="Care messages" value={stats.messageCount ?? stats.message_count ?? "—"} symbol="▤" note="Post-discharge messages" onClick={() => selectSection("chat")} />
        </div>

        <div className="patient-section-heading">
          <div>
            <span className="patient-eyebrow">YOUR CARE</span>
            <h2>Quick access</h2>
          </div>
        </div>
        <div className="patient-quick-grid">
          {navigation.filter((item) => item.id !== "dashboard").map((item) => (
            <button className="patient-quick-card" key={item.id} onClick={() => selectSection(item.id)}>
              <span className="patient-quick-symbol">{item.symbol}</span>
              <span className="patient-quick-text">
                <strong>{item.label}</strong>
                <small>{{
                  care: "View your discharge instructions and follow-up details.",
                  chat: "Continue a conversation with your care team.",
                  prescriptions: "Review your prescribed medicines.",
                  history: "View your linked medical-history records.",
                }[item.id]}</small>
              </span>
              <span className="patient-quick-arrow">↗</span>
            </button>
          ))}
        </div>
      </>
    );
  }

  function renderCare() {
    return (
      <>
        <div className="patient-page-intro">
          <span className="patient-eyebrow">RECOVERY & FOLLOW-UP</span>
          <h2>Post-discharge care</h2>
          <p>Review the discharge information and aftercare guidance recorded by your healthcare team.</p>
        </div>
        <div className="patient-record-toolbar">
          <label htmlFor="patient-care-record-search">Search discharge records</label>
          <input id="patient-care-record-search" type="search" value={recordSearch} onChange={(event) => setRecordSearch(event.target.value)} placeholder="Search diagnosis, date, or details" />
          <span>{filterRecords(discharges).length} shown</span>
        </div>
        {filterRecords(discharges).length ? (
          <div className="patient-record-list">
            {filterRecords(discharges).map((record, index) => (
              <RecordCard key={record.discharge_id ?? index} record={record} index={index} kind="discharge" />
            ))}
          </div>
        ) : !loading && !pageError ? (
          <EmptyState symbol="♡" title="No discharge records yet" description="Discharge records entered by your care team will appear here." />
        ) : null}
      </>
    );
  }

  function renderPrescriptions() {
    return (
      <>
        <div className="patient-page-intro">
          <span className="patient-eyebrow">MEDICATIONS</span>
          <h2>My prescription</h2>
          <p>Review prescription records linked to your patient profile.</p>
        </div>
        <div className="patient-record-toolbar">
          <label htmlFor="patient-prescription-record-search">Search prescriptions</label>
          <input id="patient-prescription-record-search" type="search" value={recordSearch} onChange={(event) => setRecordSearch(event.target.value)} placeholder="Search medicine, dosage, date, or details" />
          <span>{filterRecords(prescriptions).length} shown</span>
        </div>
        {filterRecords(prescriptions).length ? (
          <div className="patient-record-list">
            {filterRecords(prescriptions).map((record, index) => (
              <RecordCard key={record.prescription_id ?? index} record={record} index={index} kind="prescription" />
            ))}
          </div>
        ) : !loading && !pageError ? (
          <EmptyState symbol="✚" title="No prescriptions available" description="When a clinician records a prescription for you, it will appear here." />
        ) : null}
      </>
    );
  }


  function renderAssistant() {
    const languages = [
      { code: "en", label: "English" },
      { code: "hi", label: "Hindi" },
      { code: "mr", label: "Marathi" },
      { code: "gu", label: "Gujarati" }
    ];

    const suggestedQueries = {
      en: [
        "What are the uses and indications of metformin?",
        "I have severe chest pain and difficulty breathing",
        "Can I take aspirin and warfarin together?"
      ],
      hi: [
        "मेटफॉर्मिन के उपयोग और संकेत क्या हैं?",
        "सीने में तेज दर्द और सांस लेने में तकलीफ हो रही है",
        "क्या मैं एस्पिरिन और वारफारिन एक साथ ले सकता हूँ?"
      ],
      mr: [
        "उच्च रक्तदाबासाठी लिसिनोप्रिल 5 mg चा वापर काय आहे?",
        "माझ्या छातीत खूप तीव्र वेदना होत आहेत आणि मला श्वास घेता येत नाही",
        "मेटफॉर्मिनचे दुष्परिणाम काय आहेत?"
      ],
      gu: [
        "મેટફોર્મિનનો ઉપયોગ અને સંકેતો શું છે?",
        "મને છાતીમાં તીવ્ર દુખાવો અને શ્વાસ લેવામાં તકલીફ થઈ રહી છે",
        "શું હું એસ્પિરિન અને વૉરફરિન એકસાથે લઈ શકું?"
      ]
    };

    const suggestionHeading = {
      en: "Suggested questions",
      hi: "सुझाए गए प्रश्न",
      mr: "सुचवलेले प्रश्न",
      gu: "સૂચિત પ્રશ્નો"
    };

    const policyTitle = {
      en: "Safety Policy Notice",
      hi: "सुरक्षा नीति सूचना",
      mr: "सुरक्षा धोरण सूचना",
      gu: "સુરક્ષા નીતિ સૂચના"
    };

    const policyNotice = {
      en: "Your question is evaluated using authorized EHR history and discharge instructions. Medication-safety checks and evidence-grounding rules are applied; unsupported answers may be withheld.",
      hi: "आपके प्रश्न का मूल्यांकन अधिकृत स्वास्थ्य रिकॉर्ड और डिस्चार्ज निर्देशों के आधार पर किया जाता है। दवा-सुरक्षा जाँच और प्रमाण-आधारित सत्यापन लागू होते हैं; पर्याप्त प्रमाण न होने पर उत्तर रोका जा सकता है।",
      mr: "तुमच्या प्रश्नाचे मूल्यमापन अधिकृत आरोग्य नोंदी आणि डिस्चार्ज सूचनांच्या आधारे केले जाते. औषध-सुरक्षा तपासणी आणि पुराव्यावर आधारित पडताळणी केली जाते; पुरेसा पुरावा नसल्यास उत्तर दिले जाणार नाही.",
      gu: "તમારા પ્રશ્નનું મૂલ્યાંકન અધિકૃત આરોગ્ય રેકોર્ડ અને ડિસ્ચાર્જ સૂચનાઓના આધારે થાય છે. દવા-સુરક્ષા તપાસ અને પુરાવા આધારિત ચકાસણી લાગુ પડે છે; પૂરતો પુરાવો ન હોય તો જવાબ આપવામાં નહીં આવે."
    };

    return (
      <>
        <div className="patient-page-intro">
          <span className="patient-eyebrow">PERSONAL HEALTH SUPPORT</span>
          <h2>AI Care Assistant</h2>
          <p>
            Ask questions about your discharge instructions and documented care.
            For emergencies, contact emergency services immediately.
          </p>
        </div>

        <section className="patient-ai-panel">
          <div className="patient-ai-toolbar">
            <label htmlFor="patient-ai-language">Response language</label>
            <select
              id="patient-ai-language"
              value={assistantLanguage}
              onChange={(event) => setAssistantLanguage(event.target.value)}
              disabled={assistantSending}
            >
              {languages.map((item) => (
                <option key={item.code} value={item.code}>{item.label}</option>
              ))}
            </select>
          </div>

          <div className="patient-ai-policy-notice" role="note">
            <span aria-hidden="true">ℹ️</span>
            <div>
              <strong>{policyTitle[assistantLanguage] || policyTitle.en}</strong>
              <p>{policyNotice[assistantLanguage] || policyNotice.en}</p>
            </div>
          </div>

          <section className="patient-ai-suggestions" aria-label={suggestionHeading[assistantLanguage]}>
            <h3>{suggestionHeading[assistantLanguage] || suggestionHeading.en}</h3>
            <div className="patient-ai-suggestion-list">
              {(suggestedQueries[assistantLanguage] || suggestedQueries.en).map((query, index) => (
                <button
                  type="button"
                  key={`${assistantLanguage}-${index}`}
                  className="patient-ai-suggestion-button"
                  disabled={assistantSending}
                  onClick={() => submitAssistantQuestion(query)}
                >
                  <span aria-hidden="true">💬</span>
                  <span>{query}</span>
                </button>
              ))}
            </div>
          </section>

          <div className="patient-ai-messages" aria-live="polite">
            {!assistantMessages.length && (
              <div className="patient-ai-empty">
                <strong>How can we help with your care?</strong>
                <p>
                  Ask about information documented in your discharge or prescription
                  records. The assistant may abstain when reliable evidence is unavailable.
                </p>
              </div>
            )}

            {assistantMessages.map((item) => (
              <article
                key={item.id}
                className={`patient-ai-message ${item.role === "patient" ? "patient-ai-message-user" : "patient-ai-message-assistant"}`}
              >
                <div className="patient-ai-message-label">
                  {item.role === "patient" ? "You" : "Clinical Assistant"}
                  {" · "}
                  {({ en: "English", hi: "Hindi", mr: "Marathi", gu: "Gujarati" })[item.language] || "English"}
                </div>
                <div className="patient-ai-message-content">{renderAssistantMarkdown(item.text)}</div>
                {item.isEmergency && (
                  <strong className="patient-ai-emergency">
                    Emergency detected — contact emergency services immediately.
                  </strong>
                )}
                {!!item.sources?.length && (
                  <div className="patient-ai-sources">
                    <strong>Sources</strong>
                    {item.sources.map((source, index) => (
                      <a
                        key={`${source.url}-${index}`}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {source.title || "Clinical source"}
                      </a>
                    ))}
                  </div>
                )}
              </article>
            ))}

            {assistantSending && (
              <p className="patient-ai-working" role="status">
                Checking the available clinical evidence…
              </p>
            )}
          </div>

          <form className="patient-ai-compose" onSubmit={submitAssistantQuestion}>
            <label htmlFor="patient-ai-question">Your question</label>
            <textarea
              id="patient-ai-question"
              rows={3}
              maxLength={2000}
              required
              value={assistantQuestion}
              onChange={(event) => setAssistantQuestion(event.target.value)}
              placeholder="Ask about your documented care instructions…"
              disabled={assistantSending}
            />
            <div className="patient-ai-compose-footer">
              <span>Do not use this assistant for emergencies.</span>
              <button type="submit" disabled={assistantSending || !assistantQuestion.trim()}>
                {assistantSending ? "Checking…" : "Ask assistant"}
              </button>
            </div>
          </form>
        </section>
      </>
    );
  }

  function renderHistory() {
    return (
      <>
        <div className="patient-page-intro">
          <span className="patient-eyebrow">YOUR HEALTH INFORMATION</span>
          <h2>Medical history</h2>
          <p>Medical-history records associated with your signed-in patient account.</p>
        </div>
        <div className="patient-record-toolbar">
          <label htmlFor="patient-history-record-search">Search medical history</label>
          <input id="patient-history-record-search" type="search" value={recordSearch} onChange={(event) => setRecordSearch(event.target.value)} placeholder="Search diagnosis, date, or details" />
          <span>{filterRecords(history).length} shown</span>
        </div>
        {filterRecords(history).length ? (
          <div className="patient-record-list">
            {filterRecords(history).map((record, index) => (
              <RecordCard key={record.history_id ?? index} record={record} index={index} kind="history" />
            ))}
          </div>
        ) : !loading && !pageError ? (
          <EmptyState symbol="▧" title="No history records available" description="Medical-history entries recorded for your patient profile will appear here." />
        ) : null}
      </>
    );
  }

  function renderChat() {
    return (
      <>
        <div className="patient-page-intro">
          <span className="patient-eyebrow">YOUR CARE TEAM</span>
          <h2>Post-discharge chat</h2>
          <p>Use this space for non-emergency follow-up questions about your discharge and recovery.</p>
        </div>
        <section className="patient-chat-panel">
          <div className="patient-chat-header">
            <div className="patient-chat-avatar">✚</div>
            <div>
              <strong>{contacts.find((contact) => String(contact.user_id) === String(selectedContactId))?.full_name || "Your care team"}</strong>
              <span>{contacts.find((contact) => String(contact.user_id) === String(selectedContactId))?.role === "doctor" ? "Doctor · " + (contacts.find((contact) => String(contact.user_id) === String(selectedContactId))?.detail || "Care team") : "Receptionist · Care coordination"}</span>
            </div>
            <span className="patient-chat-status">Care messages</span>
          </div>
          <div className="patient-chat-recipient">
            <label htmlFor="patient-chat-contact">Send message to</label>
            <select
              id="patient-chat-contact"
              value={selectedContactId}
              onChange={(event) => setSelectedContactId(event.target.value)}
              disabled={!contacts.length}
            >
              {!contacts.length && <option value="">No care-team contacts available</option>}
              {contacts.map((contact) => (
                <option key={contact.user_id} value={String(contact.user_id)}>
                  {contact.full_name} — {contact.role === "doctor" ? `Doctor${contact.detail ? ` · ${contact.detail}` : ""}` : "Receptionist"}
                </option>
              ))}
            </select>
          </div>
          <div className="patient-chat-messages" aria-live="polite">
            {messages.length ? messages.map((item, index) => {
              const mine =
                item.sender_user_id === user.userId ||
                item.senderUserId === user.userId ||
                item.sender_role === "patient" ||
                item.senderRole === "patient";
              return (
                <div className={`patient-chat-row ${mine ? "mine" : "theirs"}`} key={item.message_id ?? item.id ?? index}>
                  <div className="patient-chat-bubble">
                    <p>{item.message || item.body || item.content}</p>
                    <span>{item.created_at ? new Date(item.created_at).toLocaleString() : ""}</span>
                  </div>
                </div>
              );
            }) : (
              <EmptyState symbol="▤" title="Your conversation starts here" description="Messages from your linked care team will appear here when the chat service is connected." />
            )}
          </div>
          <form className="patient-chat-compose" onSubmit={sendMessage}>
            <label className="patient-visually-hidden" htmlFor="patient-chat-message">Write a message to your care team</label>
            <textarea
              id="patient-chat-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Write a follow-up question..."
              rows={2}
              maxLength={3000}
              required
            />
            <button type="submit" disabled={sending || !message.trim()}>
              {sending ? "Sending…" : "Send message ↗"}
            </button>
          </form>
          <p className="patient-chat-disclaimer">This chat is not for emergencies. Seek urgent medical help for emergency symptoms.</p>
        </section>
      </>
    );
  }

  return (
    <PatientPortalLanguageLayer language={portalLanguage}>
      <div className="patient-app-layout">
      <aside className="patient-sidebar">
        <a className="patient-brand" href="#" onClick={(event) => { event.preventDefault(); selectSection("dashboard"); }}>
          <span className="patient-brand-mark">✚</span>
          <span>CareUnity<small>PATIENT PORTAL</small></span>
        </a>

        <div className="patient-profile-mini">
          <div className="patient-profile-avatar">
            {(user.fullName || "P").trim().charAt(0).toUpperCase()}
          </div>
          <div className="patient-profile-copy">
            <strong>{user.fullName}</strong>
            <span>Patient account</span>
          </div>
          <span className="patient-online-dot" title="Signed in" />
        </div>

        <div className="patient-nav-label">YOUR WORKSPACE</div>
        <nav className="patient-sidebar-nav" aria-label="Patient dashboard">
          {navigation.map((item) => (
            <button
              key={item.id}
              className={`patient-nav-item ${activeSection === item.id ? "active" : ""}`}
              onClick={() => selectSection(item.id)}
              aria-current={activeSection === item.id ? "page" : undefined}
            >
              <span className="patient-nav-symbol">{item.symbol}</span>
              <span>{item.label}</span>
              {activeSection === item.id && <span className="patient-nav-active-mark" />}
            </button>
          ))}
        </nav>

        <div className="patient-sidebar-bottom">
          <div className="patient-help-card">
            <span className="patient-help-symbol">?</span>
            <strong>Need assistance?</strong>
            <p>Contact your healthcare provider for account or care questions.</p>
          </div>
          <button className="patient-logout-button" onClick={onLogout}>
            <span className="patient-nav-symbol">↪</span>
            <span>Logout</span>
          </button>
          <div className="patient-sidebar-footer">CareUnity · Patient portal</div>
        </div>
      </aside>

      <main className="patient-main">
        <header className="patient-topbar">
          <div>
            <div className="patient-breadcrumb">Patient portal <span>/</span> {title}</div>
            <h1>{title}</h1>
          </div>
          <div className="patient-topbar-right">
            <div className="patient-language-switcher">
              <label htmlFor="patient-portal-language">Language</label>
              <select
                id="patient-portal-language"
                className="patient-language-select"
                value={portalLanguage}
                onChange={(event) => {
                  const nextLanguage = event.target.value;
                  setPortalLanguage(nextLanguage);
                  sessionStorage.setItem("patientPortalLanguage", nextLanguage);
                }}
                aria-label="Choose patient portal language"
              >
                <option value="en">English</option>
                <option value="hi">हिन्दी (Hindi)</option>
                <option value="gu">ગુજરાતી (Gujarati)</option>
                <option value="mr">मराठी (Marathi)</option>
              </select>
            </div>
            <span className="patient-secure-chip"><span /> Secure session</span>
            <div className="patient-topbar-avatar">{(user.fullName || "P").trim().charAt(0).toUpperCase()}</div>
          </div>
        </header>

        <div className="patient-content">
          {pageError && (
            <div className="patient-error-banner" role="alert">
              <span>!</span>
              <div><strong>Unable to load this section</strong><p>{pageError}</p></div>
              <button onClick={() => loadSection(activeSection)}>Retry</button>
            </div>
          )}
          {loading && <div className="patient-loading"><span /> Loading your information…</div>}

          {!pageError && activeSection === "dashboard" && renderDashboard()}
          {activeSection === "care" && renderCare()}
          {activeSection === "chat" && renderChat()}
          {activeSection === "assistant" && renderAssistant()}
          {activeSection === "prescriptions" && renderPrescriptions()}
          {activeSection === "history" && renderHistory()}
        </div>

        <footer className="patient-page-footer">
          <span>CareUnity <span className="patient-footer-dot">•</span> Connected healthcare</span>
          <span>For emergencies, contact local emergency services.</span>
        </footer>
      </main>
      </div>
    </PatientPortalLanguageLayer>
  );
}