'use strict';

// Client-side i18n manager
let currentLang = localStorage.getItem('werewolves.lang') || 'vi';

function t(key, params = {}) {
  // Access global dictionaries loaded from i18n files
  const dicts = window.i18nDicts || {};
  const dict = dicts[currentLang] || dicts.vi || {};
  let text = dict[key] || (dicts.vi && dicts.vi[key]) || key;

  for (const [paramKey, paramVal] of Object.entries(params)) {
    text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramVal));
  }

  return text;
}

function setLanguage(lang) {
  if (window.i18nDicts && window.i18nDicts[lang]) {
    currentLang = lang;
    localStorage.setItem('werewolves.lang', lang);
  }
}

function getLanguage() {
  return currentLang;
}

if (typeof window !== 'undefined') {
  window.t = t;
  window.setLanguage = setLanguage;
  window.getLanguage = getLanguage;
}
