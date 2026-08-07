'use strict';

// Client-side i18n manager
let currentLang = (typeof localStorage !== 'undefined' && localStorage.getItem('werewolves.lang')) || 'vi';

function t(key, params = {}) {
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
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('werewolves.lang', lang);
    }
  }
}

function getLanguage() {
  return currentLang;
}

function getRoleTranslation(role) {
  if (!role || !role.id) return '-';
  const key = `role_${role.id.replace(/-/g, '_')}_name`;
  const translated = t(key);
  return translated !== key ? translated : role.displayName || role.name || '-';
}

function getRoleDescTranslation(role) {
  if (!role || !role.id) return '';
  const key = `role_${role.id.replace(/-/g, '_')}_desc`;
  const translated = t(key);
  return translated !== key ? translated : role.description || '';
}

function getGroupTranslation(group) {
  return t(`group_${group}`);
}

if (typeof window !== 'undefined') {
  window.t = t;
  window.setLanguage = setLanguage;
  window.getLanguage = getLanguage;
  window.getRoleTranslation = getRoleTranslation;
  window.getRoleDescTranslation = getRoleDescTranslation;
  window.getGroupTranslation = getGroupTranslation;
}
