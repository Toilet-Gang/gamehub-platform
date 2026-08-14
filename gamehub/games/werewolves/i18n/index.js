'use strict';

const vi = require('./vi');
const en = require('./en');

const dictionaries = { vi, en };
let currentLang = 'vi';

function setLanguage(lang) {
  if (dictionaries[lang]) {
    currentLang = lang;
  }
}

function getLanguage() {
  return currentLang;
}

function t(key, params = {}, lang = null) {
  const targetLang = lang || currentLang;
  const dict = dictionaries[targetLang] || dictionaries.vi;
  let text = dict[key] || dictionaries.vi[key] || key;

  for (const [paramKey, paramVal] of Object.entries(params)) {
    text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramVal));
  }

  return text;
}

module.exports = {
  vi,
  en,
  dictionaries,
  setLanguage,
  getLanguage,
  t,
};
