"use strict";

document.addEventListener("DOMContentLoaded", function () {
  document.getElementById("clearDataButton").addEventListener("click", async function () {
    await clearStorage();
    clockifyApiKeyText.value = jiraEmailText.value = jiraApiTokenText.value = "";
  }, false);
  document.getElementById("syncButton").addEventListener("click", async function () {
    await changeSettingsInStorage();
    try {
      await sendRequestToExtension("startSync");
      alert("A szinkronizálás sikeres volt.");
    } catch (error) {
      console.log(error);
    }

  }, false);

  setSavedDetailsToForm();
});

function sendRequestToExtension(operation) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: operation }, response => {
      if (operation === "startSync" && response && response.status && response.status === "OK") {
        resolve();
      } else if (operation === "startSync" && response && response.status && response.status === "NOK") {
        reject(response.description);
      }
    });
  });
}

async function changeSettingsInStorage() {
  const clockifyApiKeyInStorage = await getDetailFromStorage("clockifyApiKey");
  const jiraEmailInStorage = await getDetailFromStorage("jiraEmail");
  const jiraTokenInStorage = await getDetailFromStorage("jiraToken");
  if (clockifyApiKeyInStorage && jiraEmailInStorage && jiraTokenInStorage) {
    await clearStorage();
  }
  const clockifyApiKeyInForm = document.getElementById("clockifyApiKeyText").value;
  const jiraEmailInForm = document.getElementById("jiraEmailText").value;
  const jiraTokenInForm = document.getElementById("jiraApiTokenText").value;
  if (clockifyApiKeyInForm && jiraEmailInForm && jiraTokenInForm) {
    await saveDetailsToStorage(clockifyApiKeyInForm, jiraEmailInForm, jiraTokenInForm);
  }

}

async function setSavedDetailsToForm() {
  const clockifyApiKey = await getDetailFromStorage("clockifyApiKey");
  const jiraEmail = await getDetailFromStorage("jiraEmail");
  const jiraToken = await getDetailFromStorage("jiraToken");
  if (clockifyApiKey && jiraEmail && jiraToken) {
    clockifyApiKeyText.value = clockifyApiKey;
    jiraEmailText.value = jiraEmail;
    jiraApiTokenText.value = jiraToken;
  }
}

function getDetailFromStorage(detailName) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(detailName, result => {
      if (chrome.runtime.lastError) {
        reject(Error(chrome.runtime.lastError.message));
      } else {
        resolve(result[detailName]);
      }
    });
  });
}

function clearStorage() {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.clear(() => {
      if (chrome.runtime.lastError) {
        reject(Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

function saveDetailsToStorage(clockifyApiKey, jiraEmail, jiraToken) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set({ clockifyApiKey: clockifyApiKey }, () => {
      if (chrome.runtime.lastError) {
        reject(Error(chrome.runtime.lastError.message));
      }
    });
    chrome.storage.sync.set({ jiraEmail: jiraEmail }, () => {
      if (chrome.runtime.lastError) {
        reject(Error(chrome.runtime.lastError.message));
      }
    })
    chrome.storage.sync.set({ jiraToken: jiraToken }, () => {
      if (chrome.runtime.lastError) {
        reject(Error(chrome.runtime.lastError.message));
      }
    })
    resolve();
  });
}

function toggleShowHideImputElements(obj) {
  if (obj.type === "password") {
    obj.type = "text";
  } else {
    obj.type = "password";
  }
}

document.addEventListener('DOMContentLoaded', function () {
  const fintechxWorklogSyncBtns = document.querySelectorAll('.fintechxWorklogSyncBtn');
  fintechxWorklogSyncBtns.forEach(el => el.addEventListener('mousedown', event => {
    toggleShowHideImputElements(document.getElementById(event.target.getAttribute("id") + "Text"));
    event.target.classList.toggle("bi-eye");
  }));
  fintechxWorklogSyncBtns.forEach(el => el.addEventListener('mouseup', event => {
    toggleShowHideImputElements(document.getElementById(event.target.getAttribute("id") + "Text"));
    event.target.classList.toggle("bi-eye");
  }));
}, false);