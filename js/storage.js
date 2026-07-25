// Safe localStorage access.
//
// Storage is not guaranteed: Safari Private Browsing throws QuotaExceededError
// on every write, parental-control/policy settings can throw SecurityError on
// read, and a long session can exhaust the quota. None of that should break
// drawing, chatting, or the settings toggles — preferences just stop persisting.

export function readStored(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

export function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    return false;   // storage unavailable or full — caller carries on
  }
}

export function removeStored(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (e) {
    return false;
  }
}
