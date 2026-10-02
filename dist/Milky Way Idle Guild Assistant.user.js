// ==UserScript==
// @name         公會助手
// @name:en      Milky Way Idle Guild Assistant
// @namespace    https://www.milkywayidle.com/
// @version      1.2.53
// @author       柆雨
// @license      MIT
// @homepageURL  https://github.com/LaYuDr/milky-way-idle-guild-credit-optimizer
// @description  銀河奶牛公會助手：比較信用點兌換成本、規劃神龕升級與公會建設、儲存歷史試煉統計；不會自動交易、兌換或升級，不會上傳賬號資料。
// @description:en Read-only guild assistant for credit exchange comparisons, shrine and construction planning, and trial history; does not automate buying, selling, exchanging, or upgrading, and does not upload account data.
// @match        https://www.milkywayidle.com/*
// @match        https://www.milkywayidlecn.com/*
// @grant        GM_addElement
// @grant        unsafeWindow
// @sandbox      raw
// @run-at       document-start
// @downloadURL https://raw.githubusercontent.com/yiyao0327/tampermonkey-tw/main/dist/Milky Way Idle Guild Assistant.user.js
// @updateURL https://raw.githubusercontent.com/yiyao0327/tampermonkey-tw/main/dist/Milky Way Idle Guild Assistant.user.js
// ==/UserScript==

// MWI_GUILD_CREDIT_RUNTIME
window.MwiGuildCreditVersion = "1.2.53";

// SOURCE: src/market-data.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildCreditMarketData = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const LIVE_MARKET_CACHE_SCHEMA_VERSION = 3;
  const SUPPORTED_LIVE_MARKET_CACHE_SCHEMA_VERSIONS = new Set([1, 2, 3]);
  const MAX_CACHED_ITEMS = 2000;
  const MAX_LEVELS_PER_ITEM = 101;

  function normalizeMarketTimestamp(value) {
    if (typeof value !== "number" && typeof value !== "string") return 0;
    const normalized = typeof value === "string" ? value.trim() : value;
    if (normalized === "") return 0;
    const numeric = Number(normalized);
    if (Number.isFinite(numeric)) {
      const timestamp = numeric > 0 && numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
      return timestamp > 0 && Number.isFinite(new Date(timestamp).getTime()) ? timestamp : 0;
    }
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeEnhancementLevel(value) {
    const level = Number(value);
    return Number.isSafeInteger(level) && level >= 0 ? level : null;
  }

  function normalizeCachedPrice(value) {
    const price = Number(value);
    return Number.isFinite(price) && (price > 0 || price === -1) ? price : null;
  }

  function normalizeTradablePrice(value) {
    const price = Number(value);
    return Number.isFinite(price) && price > 0 ? price : null;
  }

  function levelValue(values, level) {
    if (!values || typeof values !== "object") return undefined;
    return values[level] ?? values[String(level)];
  }

  function hasLevelValue(values, level) {
    return Boolean(
      values &&
      typeof values === "object" &&
      (Object.prototype.hasOwnProperty.call(values, level) ||
        Object.prototype.hasOwnProperty.call(values, String(level)))
    );
  }

  function metadataFieldValue(levelMap, level, field, fallback) {
    const levelValue = levelMap && levelMap[level];
    if (
      levelValue &&
      typeof levelValue === "object" &&
      !Array.isArray(levelValue) &&
      Object.prototype.hasOwnProperty.call(levelValue, field)
    ) {
      return levelValue[field];
    }
    return levelValue !== undefined && (typeof levelValue !== "object" || levelValue === null) ? levelValue : fallback;
  }

  function sanitizeMarketData(rawMarketData) {
    const marketData = Object.create(null);
    if (!rawMarketData || typeof rawMarketData !== "object" || Array.isArray(rawMarketData)) {
      return marketData;
    }
    for (const [itemHrid, levelMap] of Object.entries(rawMarketData)) {
      if (!itemHrid.startsWith("/items/") || !levelMap || typeof levelMap !== "object" || Array.isArray(levelMap))
        continue;
      const levels = Object.create(null);
      for (const [rawLevel, rawQuote] of Object.entries(levelMap)) {
        const level = normalizeEnhancementLevel(rawLevel);
        if (level === null || !rawQuote || typeof rawQuote !== "object" || Array.isArray(rawQuote)) continue;
        const quote = Object.create(null);
        for (const field of ["a", "b"]) {
          if (!Object.prototype.hasOwnProperty.call(rawQuote, field)) {
            quote[field] = -1;
            continue;
          }
          const price = Number(rawQuote[field]);
          if (Number.isFinite(price)) quote[field] = price;
        }
        if (Object.keys(quote).length) levels[String(level)] = quote;
      }
      if (Object.keys(levels).length) marketData[itemHrid] = levels;
    }
    return marketData;
  }

  function createMarketStructure(marketData) {
    return Object.entries(marketData || {})
      .map(([itemHrid, levelMap]) => [
        itemHrid,
        Object.entries(levelMap || {})
          .filter(([, quote]) => quote && typeof quote === "object" && !Array.isArray(quote))
          .map(([level, quote]) => [
            level,
            ["a", "b"].filter(
              (field) => Object.prototype.hasOwnProperty.call(quote, field) && Number.isFinite(Number(quote[field]))
            )
          ])
          .sort((left, right) => left[0].localeCompare(right[0]))
      ])
      .sort((left, right) => left[0].localeCompare(right[0]));
  }

  function countMissingMarketEntries(confirmedMarketData, incomingMarketData) {
    const incomingItems = new Map(createMarketStructure(incomingMarketData));
    let missingCount = 0;
    for (const [itemHrid, confirmedLevels] of createMarketStructure(confirmedMarketData)) {
      const incomingLevels = incomingItems.get(itemHrid);
      if (!incomingLevels) {
        missingCount += 1 + confirmedLevels.reduce((total, [, fields]) => total + 1 + fields.length, 0);
        continue;
      }
      const incomingLevelsByHrid = new Map(incomingLevels);
      for (const [level, confirmedFields] of confirmedLevels) {
        const incomingFields = incomingLevelsByHrid.get(level);
        if (!incomingFields) {
          missingCount += 1 + confirmedFields.length;
          continue;
        }
        for (const field of confirmedFields) {
          if (!incomingFields.includes(field)) missingCount += 1;
        }
      }
    }
    return missingCount;
  }

  function edgePrice(entries, useLowest) {
    if (!Array.isArray(entries)) return null;
    let result = null;
    for (const entry of entries) {
      const price = Number(entry && typeof entry === "object" ? entry.price : entry);
      if (!Number.isFinite(price) || price <= 0) continue;
      if (result === null || (useLowest ? price < result : price > result)) result = price;
    }
    // An explicitly empty side of a complete order book means there is no
    // current public quote. Preserve that fact instead of falling back to a
    // potentially stale static snapshot.
    return result === null ? -1 : result;
  }

  function normalizeMarketOrderBooksUpdate(payload) {
    const source =
      payload && (payload.marketItemOrderBooks || (payload.data && payload.data.marketItemOrderBooks) || payload);
    const itemHrid = String((source && source.itemHrid) || "").trim();
    if (!itemHrid.startsWith("/items/")) return null;

    const hasDirectBook =
      source &&
      (Object.prototype.hasOwnProperty.call(source, "asks") || Object.prototype.hasOwnProperty.call(source, "bids"));
    let rawBooks = source && source.orderBooks;
    if (!rawBooks && hasDirectBook) {
      const level = Object.prototype.hasOwnProperty.call(source, "enhancementLevel")
        ? normalizeEnhancementLevel(source.enhancementLevel)
        : 0;
      if (level === null) return null;
      rawBooks = { [level]: source };
    }
    if (!rawBooks || typeof rawBooks !== "object" || Array.isArray(rawBooks)) return null;

    const levels = Object.create(null);
    for (const [rawLevel, rawBook] of Object.entries(rawBooks)) {
      const level = normalizeEnhancementLevel(rawLevel);
      if (level === null || !rawBook || typeof rawBook !== "object" || Array.isArray(rawBook)) continue;
      const quote = Object.create(null);
      if (Object.prototype.hasOwnProperty.call(rawBook, "asks")) quote.a = edgePrice(rawBook.asks, true);
      if (Object.prototype.hasOwnProperty.call(rawBook, "bids")) quote.b = edgePrice(rawBook.bids, false);
      const hasMin =
        Object.prototype.hasOwnProperty.call(rawBook, "priceBandMin") || hasLevelValue(source.priceBandMins, level);
      const hasMax =
        Object.prototype.hasOwnProperty.call(rawBook, "priceBandMax") || hasLevelValue(source.priceBandMaxs, level);
      const min = normalizeTradablePrice(rawBook.priceBandMin ?? levelValue(source.priceBandMins, level));
      const max = normalizeTradablePrice(rawBook.priceBandMax ?? levelValue(source.priceBandMaxs, level));
      if (hasMin) quote.min = min ?? -1;
      if (hasMax) quote.max = max ?? -1;
      if (Object.keys(quote).length) levels[String(level)] = quote;
    }
    return Object.keys(levels).length ? { itemHrid, levels } : null;
  }

  function applyLiveMarketUpdate(liveData, update, options) {
    if (!liveData || typeof liveData !== "object" || !update) return false;
    const revision = Number(options && options.revision);
    const receivedAt = Number(options && options.receivedAt);
    if (!Number.isSafeInteger(revision) || revision <= 0 || !Number.isFinite(receivedAt) || receivedAt <= 0)
      return false;

    const existing = liveData[update.itemHrid] || {};
    const levels = { ...(existing.levels || {}) };
    const revisionByLevel = { ...(existing.revisionByLevel || {}) };
    const receivedAtByLevel = { ...(existing.receivedAtByLevel || {}) };
    const snapshotTimestampByLevel = { ...(existing.snapshotTimestampByLevel || {}) };
    const snapshotConflictDeferredByLevel = { ...(existing.snapshotConflictDeferredByLevel || {}) };
    const snapshotTimestamp = normalizeMarketTimestamp(options && options.snapshotTimestamp);
    for (const [level, quote] of Object.entries(levels)) {
      const fieldRevisions = Object.create(null);
      const fieldTimes = Object.create(null);
      const fieldSnapshotTimestamps = Object.create(null);
      const fieldConflictDeferrals = Object.create(null);
      for (const field of ["a", "b"]) {
        if (!Object.prototype.hasOwnProperty.call(quote || {}, field)) continue;
        fieldRevisions[field] = Number(metadataFieldValue(revisionByLevel, level, field, existing.revision));
        fieldTimes[field] = Number(metadataFieldValue(receivedAtByLevel, level, field, existing.receivedAt));
        fieldSnapshotTimestamps[field] = normalizeMarketTimestamp(
          metadataFieldValue(snapshotTimestampByLevel, level, field, existing.snapshotTimestamp)
        );
        fieldConflictDeferrals[field] =
          metadataFieldValue(snapshotConflictDeferredByLevel, level, field, false) === true;
      }
      revisionByLevel[level] = fieldRevisions;
      receivedAtByLevel[level] = fieldTimes;
      snapshotTimestampByLevel[level] = fieldSnapshotTimestamps;
      snapshotConflictDeferredByLevel[level] = fieldConflictDeferrals;
    }
    for (const [level, quote] of Object.entries(update.levels || {})) {
      const mergedQuote = { ...(levels[level] || {}) };
      const fieldRevisions = { ...(revisionByLevel[level] || {}) };
      const fieldTimes = { ...(receivedAtByLevel[level] || {}) };
      const fieldSnapshotTimestamps = { ...(snapshotTimestampByLevel[level] || {}) };
      const fieldConflictDeferrals = { ...(snapshotConflictDeferredByLevel[level] || {}) };
      for (const field of ["a", "b"]) {
        if (!Object.prototype.hasOwnProperty.call(quote, field)) continue;
        mergedQuote[field] = quote[field];
        fieldRevisions[field] = revision;
        fieldTimes[field] = receivedAt;
        fieldSnapshotTimestamps[field] = snapshotTimestamp;
        fieldConflictDeferrals[field] = false;
      }
      for (const field of ["min", "max"]) {
        if (!Object.prototype.hasOwnProperty.call(quote, field)) continue;
        const price = normalizeTradablePrice(quote[field]);
        if (price === null) delete mergedQuote[field];
        else mergedQuote[field] = price;
      }
      levels[level] = mergedQuote;
      revisionByLevel[level] = fieldRevisions;
      receivedAtByLevel[level] = fieldTimes;
      snapshotTimestampByLevel[level] = fieldSnapshotTimestamps;
      snapshotConflictDeferredByLevel[level] = fieldConflictDeferrals;
    }
    if (!Object.keys(levels).length) return false;
    liveData[update.itemHrid] = {
      levels,
      revisionByLevel,
      receivedAtByLevel,
      snapshotTimestampByLevel,
      snapshotConflictDeferredByLevel,
      revision,
      receivedAt
    };
    return true;
  }

  function reconcileLiveMarketData(liveData, options) {
    if (!liveData || typeof liveData !== "object") return { changed: false, expired: false };
    const previousTimestamp = normalizeMarketTimestamp(options && options.previousSnapshotTimestamp);
    const nextTimestamp = normalizeMarketTimestamp(options && options.nextSnapshotTimestamp);
    const snapshotData = options && options.snapshotData;
    const coveredRevision = Number(options && options.coveredRevision);
    if (nextTimestamp <= 0 || !Number.isSafeInteger(coveredRevision) || coveredRevision < 0) {
      return { changed: false, expired: false };
    }

    let changed = false;
    let expired = false;
    for (const [itemHrid, entry] of Object.entries(liveData)) {
      const levels = { ...((entry && entry.levels) || {}) };
      const revisionByLevel = { ...((entry && entry.revisionByLevel) || {}) };
      const receivedAtByLevel = { ...((entry && entry.receivedAtByLevel) || {}) };
      const snapshotTimestampByLevel = { ...((entry && entry.snapshotTimestampByLevel) || {}) };
      const snapshotConflictDeferredByLevel = {
        ...((entry && entry.snapshotConflictDeferredByLevel) || {})
      };
      const snapshotLevels = snapshotData && snapshotData[itemHrid];
      for (const [level, quote] of Object.entries(levels)) {
        const fieldRevisions = Object.create(null);
        const fieldTimes = Object.create(null);
        const fieldSnapshotTimestamps = Object.create(null);
        const fieldConflictDeferrals = Object.create(null);
        const snapshotQuote = snapshotLevels && snapshotLevels[level];
        for (const field of ["a", "b"]) {
          if (!Object.prototype.hasOwnProperty.call(quote || {}, field)) continue;
          const revision = Number(metadataFieldValue(revisionByLevel, level, field, entry.revision));
          const receivedAt = Number(metadataFieldValue(receivedAtByLevel, level, field, entry.receivedAt));
          const baselineTimestamp = normalizeMarketTimestamp(
            metadataFieldValue(snapshotTimestampByLevel, level, field, entry.snapshotTimestamp ?? previousTimestamp)
          );
          const conflictWasDeferred = metadataFieldValue(snapshotConflictDeferredByLevel, level, field, false) === true;
          const snapshotHasField = Object.prototype.hasOwnProperty.call(snapshotQuote || {}, field);
          const snapshotMatchesLive = snapshotHasField && Number(snapshotQuote[field]) === Number(quote[field]);
          const arrivedDuringRequest = Number.isSafeInteger(revision) && revision > coveredRevision;
          const snapshotIsNewer = nextTimestamp > baselineTimestamp;
          const shouldDeferConflict =
            !snapshotMatchesLive && (arrivedDuringRequest || (snapshotIsNewer && !conflictWasDeferred));
          const isCoveredBySnapshot =
            snapshotMatchesLive || (!arrivedDuringRequest && snapshotIsNewer && conflictWasDeferred);
          if (isCoveredBySnapshot) {
            delete quote[field];
            changed = true;
            expired = true;
            continue;
          }
          fieldRevisions[field] = revision;
          fieldTimes[field] = receivedAt;
          fieldSnapshotTimestamps[field] =
            baselineTimestamp <= 0
              ? nextTimestamp
              : shouldDeferConflict
                ? Math.max(baselineTimestamp, nextTimestamp)
                : baselineTimestamp;
          fieldConflictDeferrals[field] = shouldDeferConflict || conflictWasDeferred;
          if (
            fieldSnapshotTimestamps[field] !== baselineTimestamp ||
            fieldConflictDeferrals[field] !== conflictWasDeferred
          )
            changed = true;
        }
        if (!Object.keys(quote).length) {
          delete levels[level];
          delete revisionByLevel[level];
          delete receivedAtByLevel[level];
          delete snapshotTimestampByLevel[level];
          delete snapshotConflictDeferredByLevel[level];
        } else {
          revisionByLevel[level] = fieldRevisions;
          receivedAtByLevel[level] = fieldTimes;
          snapshotTimestampByLevel[level] = fieldSnapshotTimestamps;
          snapshotConflictDeferredByLevel[level] = fieldConflictDeferrals;
        }
      }
      if (!Object.keys(levels).length) {
        delete liveData[itemHrid];
      } else {
        const revisions = Object.values(revisionByLevel)
          .flatMap((value) => Object.values(value || {}))
          .map(Number)
          .filter(Number.isSafeInteger);
        const receivedTimes = Object.values(receivedAtByLevel)
          .flatMap((value) => Object.values(value || {}))
          .map(Number)
          .filter(Number.isFinite);
        liveData[itemHrid] = {
          levels,
          revisionByLevel,
          receivedAtByLevel,
          snapshotTimestampByLevel,
          snapshotConflictDeferredByLevel,
          revision: revisions.length ? Math.max(...revisions) : entry.revision,
          receivedAt: receivedTimes.length ? Math.max(...receivedTimes) : entry.receivedAt
        };
      }
    }
    return { changed, expired };
  }

  function expireLiveMarketData(liveData, options) {
    return reconcileLiveMarketData(liveData, options).expired;
  }

  function restoreLiveMarketData(value) {
    let stored = value;
    try {
      if (typeof stored === "string") stored = JSON.parse(stored);
    } catch (_) {
      return { liveData: Object.create(null), revision: 0, valid: false };
    }
    if (
      !stored ||
      typeof stored !== "object" ||
      Array.isArray(stored) ||
      !SUPPORTED_LIVE_MARKET_CACHE_SCHEMA_VERSIONS.has(stored.schemaVersion) ||
      !stored.items ||
      typeof stored.items !== "object" ||
      Array.isArray(stored.items)
    ) {
      return { liveData: Object.create(null), revision: 0, valid: false };
    }

    const liveData = Object.create(null);
    let revision = 0;
    let itemCount = 0;
    for (const [itemHrid, entry] of Object.entries(stored.items)) {
      if (itemCount >= MAX_CACHED_ITEMS) break;
      if (!itemHrid.startsWith("/items/") || !entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const levels = Object.create(null);
      const revisionByLevel = Object.create(null);
      const receivedAtByLevel = Object.create(null);
      const snapshotTimestampByLevel = Object.create(null);
      const snapshotConflictDeferredByLevel = Object.create(null);
      let levelCount = 0;
      for (const [rawLevel, rawQuote] of Object.entries(entry.levels || {})) {
        if (levelCount >= MAX_LEVELS_PER_ITEM) break;
        const level = normalizeEnhancementLevel(rawLevel);
        if (level === null || !rawQuote || typeof rawQuote !== "object" || Array.isArray(rawQuote)) continue;
        const quote = Object.create(null);
        const fieldRevisions = Object.create(null);
        const fieldTimes = Object.create(null);
        const fieldSnapshotTimestamps = Object.create(null);
        const fieldConflictDeferrals = Object.create(null);
        for (const field of ["a", "b"]) {
          if (!Object.prototype.hasOwnProperty.call(rawQuote, field)) continue;
          const price = normalizeCachedPrice(rawQuote[field]);
          if (price === null) continue;
          const levelKey = String(level);
          const levelRevision = Number(metadataFieldValue(entry.revisionByLevel, levelKey, field, entry.revision));
          const receivedAt = Number(metadataFieldValue(entry.receivedAtByLevel, levelKey, field, entry.receivedAt));
          if (
            !Number.isSafeInteger(levelRevision) ||
            levelRevision <= 0 ||
            !Number.isFinite(receivedAt) ||
            receivedAt <= 0
          )
            continue;
          quote[field] = price;
          fieldRevisions[field] = levelRevision;
          fieldTimes[field] = receivedAt;
          fieldSnapshotTimestamps[field] = normalizeMarketTimestamp(
            metadataFieldValue(entry.snapshotTimestampByLevel, levelKey, field, entry.snapshotTimestamp)
          );
          fieldConflictDeferrals[field] =
            metadataFieldValue(entry.snapshotConflictDeferredByLevel, levelKey, field, false) === true;
          revision = Math.max(revision, levelRevision);
        }
        for (const field of ["min", "max"]) {
          if (!Object.prototype.hasOwnProperty.call(rawQuote, field)) continue;
          const price = normalizeTradablePrice(rawQuote[field]);
          if (price !== null) quote[field] = price;
        }
        if (!Object.keys(quote).length) continue;
        const levelKey = String(level);
        levels[levelKey] = quote;
        revisionByLevel[levelKey] = fieldRevisions;
        receivedAtByLevel[levelKey] = fieldTimes;
        snapshotTimestampByLevel[levelKey] = fieldSnapshotTimestamps;
        snapshotConflictDeferredByLevel[levelKey] = fieldConflictDeferrals;
        levelCount += 1;
      }
      if (!Object.keys(levels).length) continue;
      const revisions = Object.values(revisionByLevel).flatMap((value) => Object.values(value));
      const receivedTimes = Object.values(receivedAtByLevel).flatMap((value) => Object.values(value));
      const entryRevision = Number(entry.revision);
      const entryReceivedAt = Number(entry.receivedAt);
      liveData[itemHrid] = {
        levels,
        revisionByLevel,
        receivedAtByLevel,
        snapshotTimestampByLevel,
        snapshotConflictDeferredByLevel,
        revision: revisions.length
          ? Math.max(...revisions)
          : Number.isSafeInteger(entryRevision) && entryRevision > 0
            ? entryRevision
            : 0,
        receivedAt: receivedTimes.length
          ? Math.max(...receivedTimes)
          : Number.isFinite(entryReceivedAt) && entryReceivedAt > 0
            ? entryReceivedAt
            : 0
      };
      itemCount += 1;
    }
    const storedRevision = Number(stored.revision);
    if (Number.isSafeInteger(storedRevision) && storedRevision > 0) revision = Math.max(revision, storedRevision);
    return { liveData, revision, valid: true };
  }

  function serializeLiveMarketData(liveData, options) {
    const revision = Number(options && options.revision);
    const restored = restoreLiveMarketData({
      schemaVersion: LIVE_MARKET_CACHE_SCHEMA_VERSION,
      revision: Number.isSafeInteger(revision) && revision > 0 ? revision : 0,
      items: liveData
    });
    return {
      schemaVersion: LIVE_MARKET_CACHE_SCHEMA_VERSION,
      revision: restored.revision,
      storedAt: Number(options && options.storedAt) || Date.now(),
      items: restored.liveData
    };
  }

  function resolveMarketPrice(snapshot, liveData, itemHrid, enhancementLevel, field) {
    const level = normalizeEnhancementLevel(enhancementLevel);
    if (!itemHrid || level === null || (field !== "a" && field !== "b")) return null;
    const liveQuote =
      liveData && liveData[itemHrid] && liveData[itemHrid].levels && liveData[itemHrid].levels[String(level)];
    const tradableRange = resolveTradableRange(liveData, itemHrid, level);
    if (liveQuote && Object.prototype.hasOwnProperty.call(liveQuote, field)) {
      const livePrice = Number(liveQuote[field]);
      if (!Number.isFinite(livePrice) || livePrice <= 0) return null;
      return field === "b" && tradableRange.min !== null && livePrice < tradableRange.min ? null : livePrice;
    }
    const snapshotQuote =
      snapshot && snapshot.marketData && snapshot.marketData[itemHrid] && snapshot.marketData[itemHrid][String(level)];
    const snapshotPrice = Number(snapshotQuote && snapshotQuote[field]);
    if (!Number.isFinite(snapshotPrice) || snapshotPrice <= 0) return null;
    return field === "b" && tradableRange.min !== null && snapshotPrice < tradableRange.min ? null : snapshotPrice;
  }

  function resolveTradableRange(liveData, itemHrid, enhancementLevel) {
    const level = normalizeEnhancementLevel(enhancementLevel);
    const quote =
      itemHrid &&
      level !== null &&
      liveData &&
      liveData[itemHrid] &&
      liveData[itemHrid].levels &&
      liveData[itemHrid].levels[String(level)];
    return {
      min: normalizeTradablePrice(quote && quote.min),
      max: normalizeTradablePrice(quote && quote.max)
    };
  }

  return {
    normalizeMarketTimestamp,
    sanitizeMarketData,
    createMarketStructure,
    countMissingMarketEntries,
    normalizeMarketOrderBooksUpdate,
    applyLiveMarketUpdate,
    reconcileLiveMarketData,
    expireLiveMarketData,
    restoreLiveMarketData,
    serializeLiveMarketData,
    resolveMarketPrice,
    resolveTradableRange
  };
});


// SOURCE: src/market-dom.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildCreditMarketDom = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ITEM_HRID_PATTERN = /^[a-z0-9_]+$/;

  function parseCompactMarketValue(value) {
    const normalized = String(value || "")
      .replace(/,/g, "")
      .replace(/\s+/g, "")
      .trim();
    const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)([KMBT]?)$/i);
    if (!match) return null;
    const multiplier = {
      "": 1,
      K: 1_000,
      M: 1_000_000,
      B: 1_000_000_000,
      T: 1_000_000_000_000
    }[match[2].toUpperCase()];
    const result = Number(match[1]) * multiplier;
    return Number.isFinite(result) && result >= 0 ? Math.round(result) : null;
  }

  function orderBookEntries(table) {
    const entries = [];
    for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
      const cells = Array.from(row.querySelectorAll("td"));
      if (cells.length < 2) continue;
      const quantity = parseCompactMarketValue(cells[0].textContent);
      const price = parseCompactMarketValue(cells[1].textContent);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) continue;
      entries.push({ price, quantity });
    }
    return entries;
  }

  function tableSide(table) {
    const actions = Array.from(table.querySelectorAll("button"))
      .map((button) => String(button.textContent || "").trim())
      .filter(Boolean);
    if (actions.some((value) => ["購買", "Buy"].includes(value))) return "asks";
    if (actions.some((value) => ["出售", "Sell"].includes(value))) return "bids";
    const heading = String((table.querySelector("thead") && table.querySelector("thead").textContent) || "");
    if (/出售價|Sell Price/i.test(heading)) return "asks";
    if (/收購價|Buy Price/i.test(heading)) return "bids";
    return "";
  }

  function currentMarketIdentity(documentRef) {
    const currentItem = documentRef.querySelector('[class*="MarketplacePanel_currentItem"]');
    if (!currentItem) return null;
    const use = currentItem.querySelector(
      '[class*="Item_itemContainer"] svg[role="img"] use[href*="items_sprite"],' +
        '[class*="Item_itemContainer"] svg[role="img"] use[xlink\\:href*="items_sprite"]'
    );
    const href = use && (use.getAttribute("href") || use.getAttribute("xlink:href"));
    const fragment = String(href || "")
      .split("#")
      .pop();
    if (!ITEM_HRID_PATTERN.test(fragment)) return null;
    const enhancementNode = currentItem.querySelector('[class*="Item_enhancementLevel"]');
    const enhancementMatch = String((enhancementNode && enhancementNode.textContent) || "").match(/\+?(\d+)/);
    const enhancementLevel = enhancementMatch ? Number(enhancementMatch[1]) : 0;
    return {
      itemHrid: `/items/${fragment}`,
      enhancementLevel: Number.isSafeInteger(enhancementLevel) && enhancementLevel >= 0 ? enhancementLevel : 0
    };
  }

  function tradableRange(documentRef) {
    if (!documentRef || typeof documentRef.querySelectorAll !== "function") return { min: null, max: null };
    for (const node of Array.from(documentRef.querySelectorAll('[class*="MarketplacePanel_"]'))) {
      const text = String(node.textContent || "").replace(/,/g, "");
      const match = text.match(
        /(?:可交易區間|Tradable\s+Range)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?[KMBT]?)\s*(?:-|–|—|~|至|到)\s*([0-9]+(?:\.[0-9]+)?[KMBT]?)/i
      );
      if (!match) continue;
      const min = parseCompactMarketValue(match[1]);
      const max = parseCompactMarketValue(match[2]);
      if (Number.isFinite(min) && min > 0 && Number.isFinite(max) && max >= min) return { min, max };
    }
    return { min: null, max: null };
  }

  function readMarketDomSnapshot(documentRef) {
    if (!documentRef || typeof documentRef.querySelector !== "function") return null;
    const identity = currentMarketIdentity(documentRef);
    const booksContainer = documentRef.querySelector('[class*="MarketplacePanel_orderBooksContainer"]');
    if (!identity || !booksContainer) return null;
    const snapshot = {
      ...identity,
      asks: null,
      bids: null,
      priceBandMin: null,
      priceBandMax: null
    };
    const range = tradableRange(documentRef);
    snapshot.priceBandMin = range.min;
    snapshot.priceBandMax = range.max;
    for (const table of Array.from(
      booksContainer.querySelectorAll('table[class*="MarketplacePanel_orderBookTable"]')
    )) {
      const side = tableSide(table);
      if (side) snapshot[side] = orderBookEntries(table);
    }
    if (!Array.isArray(snapshot.asks) && !Array.isArray(snapshot.bids)) return null;
    snapshot.signature = JSON.stringify([snapshot.itemHrid, snapshot.enhancementLevel, snapshot.asks, snapshot.bids]);
    return snapshot;
  }

  function createMarketMessage(snapshot) {
    if (!snapshot || !snapshot.itemHrid) return null;
    const book = {
      itemHrid: snapshot.itemHrid,
      enhancementLevel: snapshot.enhancementLevel
    };
    if (Array.isArray(snapshot.asks)) book.asks = snapshot.asks;
    if (Array.isArray(snapshot.bids)) book.bids = snapshot.bids;
    if (Number.isFinite(snapshot.priceBandMin) && snapshot.priceBandMin > 0) book.priceBandMin = snapshot.priceBandMin;
    if (Number.isFinite(snapshot.priceBandMax) && snapshot.priceBandMax > 0) book.priceBandMax = snapshot.priceBandMax;
    return {
      type: "market_item_order_books_updated",
      marketItemOrderBooks: book
    };
  }

  return Object.freeze({
    parseCompactMarketValue,
    tradableRange,
    readMarketDomSnapshot,
    createMarketMessage
  });
});


// SOURCE: src/runtime/config.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildCreditConfig = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CREDIT_TYPES = [
    ["/items/green_guild_credit", "#42c59f"],
    ["/items/brown_guild_credit", "#c58a42"],
    ["/items/white_guild_credit", "#e8e9ef"],
    ["/items/blue_guild_credit", "#4c99e8"],
    ["/items/purple_guild_credit", "#9567da"],
    ["/items/red_guild_credit", "#df4c5a"],
    ["/items/silver_guild_credit", "#c4cad5"],
    ["/items/gold_guild_credit", "#d8a33c"]
  ];

  const GUILD_TOKEN_CREDIT_CONVERSIONS = [
    { creditItemHrid: "/items/green_guild_credit", guildTokenCount: 1, creditCount: 10 },
    { creditItemHrid: "/items/brown_guild_credit", guildTokenCount: 1, creditCount: 10 },
    { creditItemHrid: "/items/white_guild_credit", guildTokenCount: 1, creditCount: 10 },
    { creditItemHrid: "/items/blue_guild_credit", guildTokenCount: 1, creditCount: 10 },
    { creditItemHrid: "/items/purple_guild_credit", guildTokenCount: 1, creditCount: 1 },
    { creditItemHrid: "/items/red_guild_credit", guildTokenCount: 1, creditCount: 1 },
    { creditItemHrid: "/items/silver_guild_credit", guildTokenCount: 10, creditCount: 1 },
    { creditItemHrid: "/items/gold_guild_credit", guildTokenCount: 60, creditCount: 1 }
  ];
  const UPDATE_SCRIPT_URL =
    "https://raw.githubusercontent.com/LaYuDr/milky-way-idle-guild-credit-optimizer/main/dist/milky-way-idle-guild-credit-optimizer.user.js";
  const FALLBACK_UPDATE_SCRIPT_URL =
    "https://js.nainai.eu.org/proxy/https://update.greasyfork.org/scripts/586873/%E9%93%B6%E6%B2%B3%E5%A5%B6%E7%89%9B%E5%85%AC%E4%BC%9A%E4%BF%A1%E7%94%A8%E7%82%B9%E6%80%A7%E4%BB%B7%E6%AF%94.user.js";
  const FALLBACK_INSTALL_URL =
    "https://www.tampermonkey.net/script_installation.php#url=https://js.nainai.eu.org/proxy/https://update.greasyfork.org/scripts/586873/%E9%93%B6%E6%B2%B3%E5%A5%B6%E7%89%9B%E5%85%AC%E4%BC%9A%E4%BF%A1%E7%94%A8%E7%82%B9%E6%80%A7%E4%BB%B7%E6%AF%94.user.js";

  return {
    UPDATE_SOURCES: [
      { url: UPDATE_SCRIPT_URL, installUrl: UPDATE_SCRIPT_URL },
      { url: FALLBACK_UPDATE_SCRIPT_URL, installUrl: FALLBACK_INSTALL_URL }
    ],
    FALLBACK_INSTALL_URL,
    PRICE_REFERENCE_STORAGE_KEY: "mwi-credit-price-reference",
    UI_STATE_STORAGE_KEY: "mwi-guild-credit-ui-state-v1",
    GUILD_BUILDING_PLAN_STORAGE_PREFIX: "mwi-guild-building-planner-v1",
    GUILD_TRIAL_FIRST_START_AT: Date.parse("2026-07-10T00:00:00Z"),
    GUILD_TRIAL_SKILL_ORDER: [
      "milking",
      "foraging",
      "woodcutting",
      "cheesesmithing",
      "crafting",
      "tailoring",
      "cooking",
      "brewing",
      "alchemy",
      "enhancing"
    ],
    GUILD_TRIAL_COMBAT_ORDER: ["badger", "chameleon", "jellyfish", "hedgehog", "swarm"],
    MARKET_LIVE_STORAGE_KEY: "mwi-guild-credit-live-market-v1",
    MARKETPLACE_SNAPSHOT_STORAGE_KEY: "mwi-guild-credit-market-snapshot-v1",
    MARKETPLACE_REQUEST_STATE_STORAGE_KEY: "mwi-guild-credit-market-request-v1",
    MARKETPLACE_SNAPSHOT_PATH: "/game_data/marketplace.json",
    MARKETPLACE_SNAPSHOT_ORIGINS: [
      "https://www.milkywayidle.com",
      "https://www.milkywayidlecn.com",
      "https://q7.nainai.eu.org"
    ],
    MARKETPLACE_SNAPSHOT_MAX_AGE_MS: 15 * 60 * 1000,
    MARKETPLACE_SNAPSHOT_REFRESH_COOLDOWN_MS: 60 * 1000,
    MARKETPLACE_SNAPSHOT_FORBIDDEN_BACKOFF_MS: 10 * 60 * 1000,
    UPDATE_CHECK_TIMEOUT_MS: 8000,
    SHOW_ALL_CREDIT_TOKEN_TOGGLE: false,
    PRICE_REFERENCES: { a: {}, b: {} },
    GUILD_TOKEN_BUDGET_SNAP_PERCENTAGES: [20, 40, 50, 60, 80, 100],
    GUILD_TOKEN_BUDGET_SNAP_THRESHOLD_PERCENTAGE: 2.5,
    RENDERED_MARKUP_PROPERTY: "__mwiGuildCreditRenderedMarkup",
    TRIAL_HISTORY_STORAGE_PREFIX: "mwi-guild-trial-history-v1",
    TRIAL_DISPLAY_STORAGE_PREFIX: "mwi-guild-trial-display-v1",
    PANEL_VIEWS: ["credit", "upgrade", "construction", "trials"],
    DEFAULT_TARGET_CREDIT: 100,
    DEFAULT_PANEL_ORDER: ["upgrade", "credit", "construction", "trials"],
    CREDIT_TYPES,
    GUILD_TOKEN_CREDIT_CONVERSIONS,
    SELLER_TAX_RATE: 0.05,
    GUILD_SHRINE_NAME_KEYS: {
      "/guild_shrines/force": "shrineForce",
      "/guild_shrines/tempo": "shrineTempo",
      "/guild_shrines/spirit": "shrineSpirit",
      "/guild_shrines/rarity": "shrineRarity",
      "/guild_shrines/scholar": "shrineScholar"
    }
  };
});


// SOURCE: src/trial-history.js
(function (root, factory) {
  const api = factory(
    typeof module !== "undefined" && module.exports ? require("./runtime/config.js") : root.MwiGuildCreditConfig
  );
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildTrialHistory = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (config) {
  "use strict";

  function objectData(value) {
    try {
      const parsed = typeof value === "string" ? JSON.parse(value) : value;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function updateContext(previous = {}, message, observedAt = Date.now()) {
    if (!message || typeof message !== "object") return previous;
    let next = previous;
    if (message.guildTrialDetailMap) next = { ...next, details: message.guildTrialDetailMap };
    if (Object.hasOwn(message, "guild")) {
      const guild = message.guild;
      const changed = String(guild?.id || "") !== String(previous.guild?.id || "");
      const weekChanged = timestamp(guild?.currentWeekStartAt) !== timestamp(previous.guild?.currentWeekStartAt);
      next = {
        ...next,
        guild,
        members: changed ? {} : previous.members,
        roster: changed ? null : previous.roster,
        membershipEvidence: changed ? [] : previous.membershipEvidence,
        signups: changed || weekChanged ? {} : previous.signups,
        signupLevels: changed || weekChanged ? {} : previous.signupLevels
      };
    }
    if (message.guildId != null && String(message.guildId) !== String(next.guild?.id)) return next;
    if (message.guildSharableCharacterMap) next = { ...next, members: message.guildSharableCharacterMap };
    // Stats can include names for historical participants. Only a current roster
    // response can establish membership; keep it separate from captured names.
    const roster =
      message.guildCharacterMap ??
      (message.type === "guild_characters_updated" ? message.guildSharableCharacterMap : null);
    if (next.guild?.id != null && roster && typeof roster === "object" && !Array.isArray(roster)) {
      next = {
        ...next,
        roster: Object.fromEntries(
          Object.entries(roster).map(([id, member]) => [
            id,
            { name: message.guildSharableCharacterMap?.[id]?.name || member?.name || null }
          ])
        )
      };
    }
    if (next.guild?.id != null && isObject(message.guildCharacterMap)) {
      next = {
        ...next,
        membershipEvidence: Object.entries(message.guildCharacterMap).flatMap(([id, member]) => {
          const joinedAt = timestamp(member?.joinTime);
          return Number.isSafeInteger(joinedAt) && joinedAt > 0 && joinedAt <= observedAt
            ? [{ characterId: String(id), name: next.members?.[id]?.name || member?.name || "", joinedAt, observedAt }]
            : [];
        })
      };
    }
    if (isObject(message.guildCharacterMap)) next = { ...next, signups: message.guildCharacterMap };
    if (isObject(message.guildTrialSignupLevelMap)) next = { ...next, signupLevels: message.guildTrialSignupLevelMap };
    else if (message.type === "guild_characters_updated") next = { ...next, signupLevels: {} };
    if (message.type === "guild_trial_signup_updated" && next.signups?.[message.characterId]) {
      next = {
        ...next,
        signups: {
          ...next.signups,
          [message.characterId]: {
            ...next.signups[message.characterId],
            signedUpSkillingTrialHrid: message.signedUpSkillingTrialHrid,
            signedUpCombatTrialHrid: message.signedUpCombatTrialHrid,
            signupWeekStartAt: message.signupWeekStartAt
          }
        },
        signupLevels: { ...next.signupLevels, [message.characterId]: message.trialSignupLevels || {} }
      };
    }
    return next;
  }

  function timestamp(value) {
    return typeof value === "number" ? value : Date.parse(value);
  }

  // Historical joins may belong to a previous membership period. Only use the
  // current guild roster's evidence when displaying a member's joining time.
  function currentMemberJoinedAt(context = {}, identity = {}) {
    if (context.guild?.id == null || identity.id == null || !Object.hasOwn(context.roster || {}, identity.id))
      return null;
    const entry = context.membershipEvidence?.find((entry) => entry.characterId === String(identity.id));
    return entry &&
      Number.isSafeInteger(entry.joinedAt) &&
      entry.joinedAt > 0 &&
      entry.joinedAt <= 8640000000000000 &&
      Number.isSafeInteger(entry.observedAt) &&
      entry.joinedAt <= entry.observedAt
      ? entry.joinedAt
      : null;
  }

  function currentMembershipRankings(context = {}) {
    if (context.guild?.id == null) return [];
    return Object.entries(context.roster || {}).map(([id, member]) => ({
      key: JSON.stringify(["id", id]),
      id,
      name: member?.name || context.members?.[id]?.name || "",
      joinedAt: currentMemberJoinedAt(context, { id })
    }));
  }

  function memberLevel(record, row) {
    const level = record.memberLevels?.[row.memberKey ?? row.characterId];
    return isMetric(level) ? level : null;
  }

  function withMemberLevels(record, context = {}) {
    if (
      record.schemaVersion !== 1 ||
      String(context.guild?.id) !== record.guildId ||
      timestamp(context.guild?.currentWeekStartAt) !== record.weekStartAt
    )
      return record;
    const memberLevels = { ...record.memberLevels };
    let changed = false;
    for (const row of record.rows) {
      if (memberLevel(record, row) !== null) continue;
      const signup = context.signups?.[row.characterId];
      const project = record.kind === "combat" ? signup?.signedUpCombatTrialHrid : signup?.signedUpSkillingTrialHrid;
      if (project !== record.trialHrid || timestamp(signup?.signupWeekStartAt) !== record.weekStartAt) continue;
      const levels = context.signupLevels?.[row.characterId];
      const level = record.kind === "combat" ? levels?.combatLevel : levels?.skillingTrialLevel;
      if (!isMetric(level)) continue;
      memberLevels[row.characterId] = level;
      changed = true;
    }
    return changed ? { ...record, memberLevels } : record;
  }

  function mergeMembershipEvidence(...lists) {
    const merged = new Map();
    for (const entry of lists.flat()) {
      const key = JSON.stringify([entry.characterId, entry.joinedAt]);
      if (!merged.has(key) || merged.get(key).observedAt < entry.observedAt) merged.set(key, entry);
    }
    return [...merged.values()].sort((a, b) => a.characterId.localeCompare(b.characterId) || a.joinedAt - b.joinedAt);
  }

  function withMembershipEvidence(record, context = {}) {
    if (record.schemaVersion !== 1 || record.source === "manual" || record.guildId !== String(context.guild?.id))
      return record;
    const evidence = mergeMembershipEvidence(record.membershipEvidence || [], context.membershipEvidence || []);
    const trials = objectData(context.guild?.currentTrialsData);
    const weekTrials =
      !record.weekTrials &&
      record.weekStartAt === timestamp(context.guild?.currentWeekStartAt) &&
      isObject(trials.skilling?.parties) &&
      isObject(trials.combat?.parties)
        ? Object.fromEntries(["skilling", "combat"].map((kind) => [kind, Object.keys(trials[kind].parties)]))
        : record.weekTrials;
    const evidenceChanged =
      evidence.length > 0 && JSON.stringify(evidence) !== JSON.stringify(record.membershipEvidence);
    if (!evidenceChanged && weekTrials === record.weekTrials) return record;
    return {
      ...record,
      ...(evidenceChanged ? { membershipEvidence: evidence } : {}),
      ...(weekTrials ? { weekTrials } : {})
    };
  }

  function validMembershipEvidence(record) {
    if (record.membershipEvidence === undefined) return true;
    return (
      record.schemaVersion === 1 &&
      Array.isArray(record.membershipEvidence) &&
      record.membershipEvidence.length <= 10000 &&
      record.membershipEvidence.every(
        (entry) =>
          isObject(entry) &&
          isText(entry.characterId) &&
          typeof entry.name === "string" &&
          entry.name.length <= 500 &&
          Number.isSafeInteger(entry.joinedAt) &&
          entry.joinedAt > 0 &&
          Number.isSafeInteger(entry.observedAt) &&
          entry.observedAt >= entry.joinedAt
      )
    );
  }

  function validWeekTrials(record) {
    return (
      record.weekTrials === undefined ||
      (record.schemaVersion === 1 &&
        isObject(record.weekTrials) &&
        ["skilling", "combat"].every(
          (kind) =>
            Array.isArray(record.weekTrials[kind]) &&
            record.weekTrials[kind].length <= 100 &&
            record.weekTrials[kind].every(isText) &&
            new Set(record.weekTrials[kind]).size === record.weekTrials[kind].length
        ))
    );
  }

  function validMemberLevels(record) {
    if (record.memberLevels === undefined) return true;
    if (!isObject(record.memberLevels) || !Array.isArray(record.rows)) return false;
    const ids = new Set(record.rows.map((row) => String(row?.memberKey ?? row?.characterId)));
    return Object.entries(record.memberLevels).every(
      ([id, level]) => ids.has(id) && (level === null || isMetric(level))
    );
  }

  function memberIdentity(record, row) {
    return {
      id: row.characterId == null ? null : String(row.characterId),
      name: record.members?.[row.memberKey ?? row.characterId]?.name || ""
    };
  }

  function sameMember(a, b) {
    if (a.id !== null && b.id !== null) return a.id === b.id;
    // Manual imports have no character ID; only an exact, known name can match.
    return Boolean(a.name && a.name === b.name);
  }

  function historyMembers(records) {
    const members = new Map();
    const idsByName = new Map();
    for (const week of historyWeeks(records))
      for (const record of week.records)
        for (const row of record.rows) {
          const identity = memberIdentity(record, row);
          if (!identity.name) continue;
          const key = JSON.stringify([identity.id === null ? "name" : "id", identity.id ?? identity.name]);
          if (!members.has(key)) members.set(key, { key, ...identity });
          if (identity.id !== null) {
            if (!idsByName.has(identity.name)) idsByName.set(identity.name, new Set());
            idsByName.get(identity.name).add(identity.id);
          }
        }
    // Keep distinct IDs even when names coincide; collapse a manual alias only when unambiguous.
    return [...members.values()]
      .filter((member) => {
        if (member.id !== null || idsByName.get(member.name)?.size !== 1) return true;
        const [id] = idsByName.get(member.name);
        return members.get(JSON.stringify(["id", id]))?.name !== member.name;
      })
      .sort((a, b) => memberCollator.compare(a.name, b.name));
  }

  function memberHistory(records, identity) {
    return historyWeeks(
      records.filter((record) => record.rows.some((row) => sameMember(identity, memberIdentity(record, row))))
    );
  }

  function memberAbsent(record, row, context = {}) {
    if (!context.guild || !context.roster) return false;
    const sameGuild =
      record.guildId != null
        ? String(record.guildId) === String(context.guild.id)
        : Boolean(record.guildName && record.guildName === context.guild.name);
    if (!sameGuild) return false;
    if (row.characterId != null) return !Object.hasOwn(context.roster, String(row.characterId));
    const name = record.members?.[row.memberKey]?.name;
    const members = Object.values(context.roster);
    // ID-less imports can only be checked by name when every roster name is known.
    return Boolean(name && members.every((member) => member.name) && !members.some((member) => member.name === name));
  }

  // The official stats response contains every trial. Only completed parties
  // have final statistics; keep the entire row, including future server fields.
  function completedSnapshots(context, message, capturedAt = Date.now()) {
    if (message?.type !== "guild_trial_stats_updated" || !Array.isArray(message.guildTrialStatList)) return [];
    const guild = context?.guild;
    if (!guild?.id || String(message.guildId) !== String(guild.id)) return [];
    const weekStartAt =
      typeof guild.currentWeekStartAt === "number" ? guild.currentWeekStartAt : Date.parse(guild.currentWeekStartAt);
    if (!Number.isSafeInteger(weekStartAt) || weekStartAt <= 0 || weekStartAt > capturedAt) return [];
    const trials = objectData(guild.currentTrialsData);
    const snapshots = [];
    for (const kind of ["skilling", "combat"]) {
      for (const [trialHrid, party] of Object.entries(trials[kind]?.parties || {})) {
        if (party?.done !== true) continue;
        const rows = message.guildTrialStatList.filter((row) => row && row.trialHrid === trialHrid);
        // Empty responses can occur while the server is publishing stats.
        // Never let them overwrite an already captured complete result.
        if (!rows.length) continue;
        const members = {};
        for (const row of rows) {
          const member = context.members?.[row.characterId];
          if (member) members[row.characterId] = member;
        }
        snapshots.push(
          JSON.parse(
            JSON.stringify(
              withMemberLevels(
                {
                  schemaVersion: 1,
                  key: JSON.stringify([String(guild.id), weekStartAt, trialHrid]),
                  guildId: String(guild.id),
                  guildName: String(guild.name || guild.id),
                  weekStartAt,
                  trialHrid,
                  kind,
                  capturedAt,
                  weekTrials: Object.fromEntries(
                    ["skilling", "combat"].map((kind) => [kind, Object.keys(trials[kind]?.parties || {})])
                  ),
                  points: trials.points?.[trialHrid] ?? null,
                  party,
                  rows,
                  members,
                  trialDetail: context.details?.[trialHrid] || null
                },
                context
              )
            )
          )
        );
      }
    }
    return snapshots.map((record) => withMembershipEvidence(record, context));
  }

  // The game stores a 0–1 ratio and floors its percentage for display.
  // Missing progress in older archives is unknown, not zero.
  function nextTierProgress(record) {
    const value = record?.party?.nextTierProgress;
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
  }

  function withSavedProgress(record, previous) {
    if (
      previous?.key !== record.key ||
      previous.kind !== record.kind ||
      !Number.isFinite(record.party?.highestTier) ||
      previous.party?.highestTier !== record.party.highestTier ||
      nextTierProgress(record) !== null ||
      nextTierProgress(previous) === null
    )
      return record;
    return { ...record, party: { ...record.party, nextTierProgress: nextTierProgress(previous) } };
  }

  function validSnapshot(value) {
    if (!validMemberLevels(value || {}) || !validMembershipEvidence(value || {}) || !validWeekTrials(value || {}))
      return false;
    if (value?.party?.nextTierProgress != null && nextTierProgress(value) === null) return false;
    if (value?.schemaVersion === 2) return validManualSnapshot(value);
    return Boolean(
      value &&
      value.schemaVersion === 1 &&
      typeof value.guildId === "string" &&
      Number.isSafeInteger(value.weekStartAt) &&
      value.weekStartAt > 0 &&
      typeof value.trialHrid === "string" &&
      ["combat", "skilling"].includes(value.kind) &&
      value.key === JSON.stringify([value.guildId, value.weekStartAt, value.trialHrid]) &&
      Number.isFinite(value.capturedAt) &&
      value.party?.done === true &&
      Array.isArray(value.rows) &&
      value.rows.length &&
      value.rows.every((row) => row && row.trialHrid === value.trialHrid)
    );
  }

  const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
  const isObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
  const isText = (value) => typeof value === "string" && value.length > 0 && value.length <= 500;
  const isMetric = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const validDate = (value) =>
    value === null ||
    (typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value);

  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  function weekNumber(weekStartAt) {
    return Math.floor((weekStartAt - config.GUILD_TRIAL_FIRST_START_AT) / WEEK_MS) + 1;
  }

  // One verified legacy spreadsheet replaced k/K with 000 in its name column.
  // Scope corrections to its exact provenance, row and source cell; never infer
  // identities by globally replacing text or assign character IDs to imports.
  function repairLegacyMemberNames(record) {
    if (
      record?.schemaVersion !== 2 ||
      record.source !== "manual" ||
      record.recordId !== "7b1591d8-9b9c-5aaf-9552-39dcebea9277" ||
      record.sourceSha256 !== "f85b3a0c18ad9217bae121da5eeba254922f4907fa7a683a752f99025f68f1e8" ||
      record.kind !== "combat" ||
      record.trialHrid !== "/guild_combat/swarm" ||
      !isObject(record.members) ||
      !Array.isArray(record.rows)
    )
      return record;
    let members = record.members;
    for (const [line, originalName, name] of [
      [6, "000wy", "kwy"],
      [11, "BS000", "BSK"],
      [14, "ABCDEFGHIJ000MLN", "ABCDEFGHIJKMLN"],
      [19, "BigBa000a", "BigBaKa"],
      [29, "catcoo000ie", "catcookie"],
      [32, "tian000ongyiran", "tiankongyiran"],
      [35, "000aela", "Kaela"],
      [37, "su000hoiwham", "sukhoiwham"],
      [42, "Ryuu000u2", "Ryuuku2"],
      [47, "000ali000uno", "kalikuno"]
    ]) {
      const key = `excel-row-${line}`;
      const row = record.rows.find((entry) => entry?.memberKey === key);
      if (
        row?.characterId !== null ||
        row.sourceCells?.[`J${line}`]?.value !== originalName ||
        members[key]?.name !== originalName
      )
        continue;
      if (members === record.members) members = { ...members };
      members[key] = {
        ...members[key],
        name,
        nameCorrection: { originalName, reason: "legacy-excel-k-replacement" }
      };
    }
    return members === record.members ? record : { ...record, members };
  }

  // Calendar dates are interpreted in UTC, independent of browser timezone.
  // Never infer a year from the current clock or a yearless chat timestamp.
  function normalizeSnapshot(record) {
    record = repairLegacyMemberNames(record);
    if (record?.schemaVersion !== 2 || typeof record.trialDate !== "string") return record;
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(record.trialDate);
    if (!match) return record;
    const trialDate = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    if (!validDate(trialDate)) return record;
    const weekStartAt =
      config.GUILD_TRIAL_FIRST_START_AT +
      Math.floor((Date.parse(trialDate) - config.GUILD_TRIAL_FIRST_START_AT) / WEEK_MS) * WEEK_MS;
    return { ...record, trialDate, weekStartAt: record.weekStartAt === null ? weekStartAt : record.weekStartAt };
  }

  function validManualSnapshot(value) {
    return Boolean(
      value &&
      value.schemaVersion === 2 &&
      value.source === "manual" &&
      isText(value.recordId) &&
      value.key === JSON.stringify(["manual", value.recordId]) &&
      value.guildId === null &&
      (value.guildName === null || isText(value.guildName)) &&
      validDate(value.trialDate) &&
      (value.trialDate === null
        ? value.weekStartAt === null
        : Date.parse(value.trialDate) >= config.GUILD_TRIAL_FIRST_START_AT &&
          (value.weekStartAt === null ||
            value.weekStartAt === normalizeSnapshot({ ...value, weekStartAt: null }).weekStartAt)) &&
      value.capturedAt === null &&
      isText(value.trialHrid) &&
      ["combat", "skilling"].includes(value.kind) &&
      isObject(value.party) &&
      value.party.done === true &&
      isObject(value.members) &&
      Array.isArray(value.rows) &&
      value.rows.length > 0 &&
      value.rows.every(
        (row) =>
          isObject(row) &&
          row.trialHrid === value.trialHrid &&
          row.characterId === null &&
          isText(row.memberKey) &&
          Object.hasOwn(value.members, row.memberKey) &&
          isText(value.members[row.memberKey]?.name)
      )
    );
  }

  function snapshotTime(record) {
    return record.weekStartAt || (record.trialDate ? Date.parse(record.trialDate) : 0);
  }

  function compareSnapshots(a, b) {
    return snapshotTime(b) - snapshotTime(a) || a.trialHrid.localeCompare(b.trialHrid);
  }

  function historyProjectKey(record) {
    return JSON.stringify([record.kind, record.trialHrid]);
  }

  // Group records for display only: never combine member rows or discard duplicates.
  function historyProjects(records, details = {}) {
    const groups = new Map();
    for (const record of records) {
      const key = historyProjectKey(record);
      if (!groups.has(key)) groups.set(key, { key, kind: record.kind, records: [] });
      groups.get(key).records.push(record);
    }
    const order = (group) => {
      const record = group.records[0];
      if (group.kind === "skilling") {
        const skill = String(details[record.trialHrid]?.skillHrid || record.trialDetail?.skillHrid || record.trialHrid)
          .split("/")
          .pop();
        const index = config.GUILD_TRIAL_SKILL_ORDER.indexOf(skill);
        return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
      }
      const index =
        details[record.trialHrid]?.sortIndex ??
        group.records.find((item) => Number.isFinite(item.trialDetail?.sortIndex))?.trialDetail.sortIndex;
      return Number.isFinite(index) ? index : Number.MAX_SAFE_INTEGER;
    };
    return [...groups.values()].sort(
      (a, b) =>
        Number(a.kind === "combat") - Number(b.kind === "combat") || order(a) - order(b) || a.key.localeCompare(b.key)
    );
  }

  function historyWeeks(records) {
    const groups = new Map();
    for (const record of records) {
      const normalized = normalizeSnapshot(record);
      const ordinal = normalized.weekStartAt ? weekNumber(normalized.weekStartAt) : null;
      const key = ordinal === null ? "unknown" : String(ordinal);
      if (!groups.has(key))
        groups.set(key, {
          key,
          weekNumber: ordinal,
          weekStartAt: ordinal === null ? null : config.GUILD_TRIAL_FIRST_START_AT + (ordinal - 1) * WEEK_MS,
          records: []
        });
      groups.get(key).records.push(record);
    }
    return [...groups.values()].sort((a, b) => (b.weekNumber ?? -1) - (a.weekNumber ?? -1));
  }

  function importError(code, index) {
    const error = new Error(code);
    error.code = code;
    if (index !== undefined) error.recordIndex = index + 1;
    throw error;
  }

  function parseImport(text) {
    if (typeof text !== "string" || text.length > MAX_IMPORT_BYTES) importError("trialImportTooLarge");
    let value;
    try {
      value = JSON.parse(text.replace(/^\uFEFF/, ""), (key, item) => {
        if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("unsafe key");
        return item;
      });
    } catch (_) {
      importError("trialImportInvalidJson");
    }
    if (
      !isObject(value) ||
      ![1, 2].includes(value.schemaVersion) ||
      !Array.isArray(value.records) ||
      !value.records.length ||
      value.records.length > 1000
    )
      importError("trialImportInvalidFile");
    const keys = new Set();
    value.records = value.records.map(normalizeSnapshot);
    for (const [index, record] of value.records.entries()) {
      if (
        !validSnapshot(record) ||
        !isObject(record.members) ||
        !isObject(record.party) ||
        !isText(record.trialHrid) ||
        record.rows.length > 1000 ||
        !(record.points === null || isMetric(record.points)) ||
        !(
          record.party.highestTier === undefined ||
          record.party.highestTier === null ||
          isMetric(record.party.highestTier)
        )
      )
        importError("trialImportInvalidRecord", index);
      if (
        record.schemaVersion === 1 &&
        (!isText(record.guildId) || !isText(record.guildName) || record.capturedAt <= 0 || record.source === "manual")
      )
        importError("trialImportInvalidRecord", index);
      const fields =
        record.kind === "combat" ? ["damageDealt", "healingDone", "premitigatedDamageTaken"] : ["workDone"];
      const memberKeys = new Set();
      for (const row of record.rows) {
        const id = record.source === "manual" ? row.memberKey : row.characterId;
        if (
          !(isText(id) || (Number.isSafeInteger(id) && id > 0)) ||
          memberKeys.has(String(id)) ||
          fields.some((field) => !(record.schemaVersion === 1 && row[field] === undefined) && !isMetric(row[field]))
        )
          importError("trialImportInvalidRecord", index);
        memberKeys.add(String(id));
        const member = record.members[id];
        if (member !== undefined && (!isObject(member) || !isText(member.name)))
          importError("trialImportInvalidRecord", index);
      }
      if (keys.has(record.key)) importError("trialImportDuplicateKey", index);
      keys.add(record.key);
    }
    return value.records;
  }

  function contentSignature(value) {
    if (Array.isArray(value)) return `[${value.map(contentSignature).join(",")}]`;
    if (isObject(value))
      return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${contentSignature(value[key])}`)
        .join(",")}}`;
    return JSON.stringify(value);
  }

  // Official v1 statistics omit zero fields; explicit null and manual gaps stay unknown.
  function metricValue(record, row, field) {
    const value = row[field];
    if (value === undefined && record.schemaVersion === 1) return 0;
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  }

  const memberCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
  function summarizeMetric(record, field) {
    const values = record.rows
      .map((row) => (field === "level" ? memberLevel(record, row) : metricValue(record, row, field)))
      .filter((value) => value !== null)
      .sort((a, b) => a - b);
    const count = values.length;
    // Zero remains known for totals, coverage and medians, but is not a
    // contributor to this metric's per-member average.
    const contributors = values.filter((value) => value > 0);
    const sum = values.reduce((total, value) => total + value, 0);
    const middle = Math.floor(count / 2);
    return {
      count,
      missing: record.rows.length - count,
      total: count && Number.isFinite(sum) ? sum : null,
      average: contributors.length
        ? contributors.reduce((total, value) => total + value / contributors.length, 0)
        : null,
      median: count ? (count % 2 ? values[middle] : values[middle - 1] / 2 + values[middle] / 2) : null
    };
  }

  function metricShare(record, row, field, summary = summarizeMetric(record, field)) {
    const value = metricValue(record, row, field);
    return value !== null && summary.total > 0 ? (value / summary.total) * 100 : null;
  }

  // A partial denominator cannot establish a low contribution. Compare the raw
  // percentage, never the rounded display text; official omitted zero is valid.
  function lowWorkShare(record, row, summary = summarizeMetric(record, "workDone")) {
    if (record.kind !== "skilling" || record.party?.done !== true || summary.missing) return null;
    const share = metricShare(record, row, "workDone", summary);
    // Compare the fraction before multiplying by 100: 90 / 10000 * 100
    // is 0.8999999999999999 in JavaScript, but must not be flagged.
    return share !== null && metricValue(record, row, "workDone") / summary.total < 9 / 1000 ? share : null;
  }

  function signupWorkWarnings(records, context = {}, trialHrid) {
    const warnings = new Map();
    const week = timestamp(context.guild?.currentWeekStartAt);
    if (context.guild?.id == null || !Number.isFinite(week) || !trialHrid) return warnings;
    const latest = new Map();
    for (const record of records) {
      if (
        record.schemaVersion !== 1 ||
        record.source === "manual" ||
        record.kind !== "skilling" ||
        record.guildId !== String(context.guild.id) ||
        record.trialHrid !== trialHrid ||
        record.party?.done !== true ||
        !Number.isFinite(record.weekStartAt) ||
        record.weekStartAt >= week
      )
        continue;
      for (const row of record.rows) {
        if (row.characterId == null) continue;
        const id = String(row.characterId);
        const previous = latest.get(id);
        if (
          !previous ||
          record.weekStartAt > previous.record.weekStartAt ||
          (record.weekStartAt === previous.record.weekStartAt && record.capturedAt > previous.record.capturedAt)
        )
          latest.set(id, { record, row });
      }
    }
    const summaries = new Map();
    for (const [id, { record, row }] of latest) {
      const signup = context.signups?.[id];
      if (signup?.signedUpSkillingTrialHrid !== trialHrid || timestamp(signup.signupWeekStartAt) !== week) continue;
      if (!summaries.has(record)) summaries.set(record, summarizeMetric(record, "workDone"));
      const share = lowWorkShare(record, row, summaries.get(record));
      if (share !== null) warnings.set(id, { share, weekStartAt: record.weekStartAt });
    }
    return warnings;
  }

  function metricAverageMultiple(record, row, field, summary = summarizeMetric(record, field)) {
    const value = metricValue(record, row, field);
    if (value === null || !(summary.average > 0) || !Number.isFinite(summary.average)) return null;
    const multiple = value / summary.average;
    return Number.isFinite(multiple) ? multiple : null;
  }

  // Rankings use game-captured v1 records only; manual v2 transcripts remain in history.
  // Missing projects never imply absence or zero.
  function participationRankings(records) {
    const players = new Map();
    const seenRecords = new Set();
    const bucket = () => ({ count: 0, average: null });
    const add = (target, value) => {
      target.count += 1;
      target.average = target.average === null ? value : target.average + (value - target.average) / target.count;
    };
    for (const record of records) {
      if (record.schemaVersion !== 1 || record.source === "manual") continue;
      if (seenRecords.has(record.key)) continue;
      seenRecords.add(record.key);
      const fields =
        record.kind === "skilling" ? ["workDone"] : ["damageDealt", "healingDone", "premitigatedDamageTaken"];
      const summaries = fields.map((field) => summarizeMetric(record, field));
      const seenPlayers = new Set();
      for (const row of record.rows) {
        const identity = memberIdentity(record, row);
        if (identity.id === null && !identity.name) continue;
        // ID-less records stay separate from official identities, even when names match.
        const key = JSON.stringify([identity.id === null ? "name" : "id", identity.id ?? identity.name]);
        if (seenPlayers.has(key)) continue;
        seenPlayers.add(key);
        if (!players.has(key))
          players.set(key, {
            key,
            ...identity,
            participations: 0,
            skilling: bucket(),
            combat: bucket(),
            damageDealt: bucket(),
            healingDone: bucket(),
            premitigatedDamageTaken: bucket()
          });
        const player = players.get(key);
        if (!player.name && identity.name) player.name = identity.name;
        player.participations += 1;
        const multiples = fields
          .map((field, index) => {
            const value = metricAverageMultiple(record, row, field, summaries[index]);
            if (record.kind === "combat" && value !== null) add(player[field], value);
            return value;
          })
          .filter((value) => value !== null);
        if (!multiples.length) continue;
        const multiple = multiples.reduce((sum, value) => sum + value, 0);
        add(player[record.kind], multiple);
      }
    }
    return [...players.values()].map((player) => ({
      ...player,
      all: {
        count: player.skilling.count + player.combat.count,
        total:
          player.skilling.average === null
            ? player.combat.average
            : player.combat.average === null
              ? player.skilling.average
              : player.skilling.average + player.combat.average
      }
    }));
  }

  // A guild week is one denominator unit per category, regardless of project count.
  // Absence requires both membership evidence and a completely captured category.
  function playerRankings(records) {
    const captured = [
      ...new Map(
        records
          .filter((record) => record.schemaVersion === 1 && record.source !== "manual")
          .map((record) => [record.key, record])
      ).values()
    ];
    const players = new Map(participationRankings(captured).map((player) => [player.key, player]));
    const guilds = new Map();
    const weeks = new Map();
    for (const record of captured) {
      const guildKey = record.guildId ?? "";
      if (!guilds.has(guildKey)) guilds.set(guildKey, { players: new Set(), evidence: new Map() });
      const guild = guilds.get(guildKey);
      for (const row of record.rows) {
        const identity = memberIdentity(record, row);
        guild.players.add(JSON.stringify([identity.id === null ? "name" : "id", identity.id ?? identity.name]));
      }
      for (const entry of record.membershipEvidence || []) {
        const key = JSON.stringify(["id", entry.characterId]);
        guild.players.add(key);
        guild.evidence.set(key, mergeMembershipEvidence(guild.evidence.get(key) || [], [entry]));
        if (!players.has(key)) players.set(key, { key, id: entry.characterId, name: entry.name, participations: 0 });
      }
      const weekKey = JSON.stringify([guildKey, record.weekStartAt ?? record.key]);
      if (!weeks.has(weekKey)) weeks.set(weekKey, { guild, at: record.weekStartAt, records: [] });
      weeks.get(weekKey).records.push(record);
    }
    const bucket = () => ({
      count: 0,
      sampleCount: 0,
      average: null,
      absentWeeks: 0,
      unknownWeeks: 0,
      incomplete: false
    });
    for (const player of players.values()) {
      player.skilling = bucket();
      player.combat = bucket();
      for (const field of ["damageDealt", "healingDone", "premitigatedDamageTaken"]) player[field] = bucket();
    }
    for (const week of weeks.values()) {
      const attendees = new Map(participationRankings(week.records).map((player) => [player.key, player]));
      for (const key of week.guild.players) {
        const player = players.get(key);
        if (!player) continue;
        const attendance = attendees.get(key);
        const evidence = week.guild.evidence.get(key) || [];
        const eligible =
          attendance || evidence.some((entry) => entry.joinedAt < week.at && entry.observedAt >= week.at);
        // Exclude weeks before the earliest documented joining, unless actual attendance proves otherwise.
        if (!eligible && evidence.length && evidence.every((entry) => entry.joinedAt >= week.at)) continue;
        for (const scope of ["skilling", "combat", "damageDealt", "healingDone", "premitigatedDamageTaken"]) {
          const kind = scope === "skilling" ? "skilling" : "combat";
          const category = week.records.filter((record) => record.kind === kind);
          const expected = [...new Set(week.records.flatMap((record) => record.weekTrials?.[kind] || []))];
          if (!category.length && !expected.length) continue;
          const result = player[scope];
          const actual = attendance?.[scope];
          const appeared = category.some((record) =>
            record.rows.some((row) => {
              const identity = memberIdentity(record, row);
              return identity.id === player.id && (player.id !== null || identity.name === player.name);
            })
          );
          // Attendance samples are independent of the eligible-week averaging denominator.
          if (appeared) result.sampleCount += 1;
          const complete =
            expected.length > 0 && expected.every((hrid) => category.some((record) => record.trialHrid === hrid));
          const score = actual?.average ?? (!appeared && eligible && complete ? 0 : null);
          if (score === null) {
            result.unknownWeeks += 1;
            result.incomplete = true;
            continue;
          }
          result.count += 1;
          result.average = result.average === null ? score : result.average + (score - result.average) / result.count;
          if (!appeared) result.absentWeeks += 1;
        }
      }
    }
    // Flag gaps before/between saved weeks without inventing zero contributions.
    for (const guild of guilds.values()) {
      const guildWeeks = [...weeks.values()].filter((week) => week.guild === guild && Number.isFinite(week.at));
      for (const [key, evidence] of guild.evidence) {
        const player = players.get(key);
        for (const scope of ["skilling", "combat", "damageDealt", "healingDone", "premitigatedDamageTaken"]) {
          const kind = scope === "skilling" ? "skilling" : "combat";
          const dates = [
            ...new Set(
              guildWeeks.filter((week) => week.records.some((record) => record.kind === kind)).map((week) => week.at)
            )
          ];
          if (!dates.length) continue;
          const latest = Math.max(...dates);
          for (const entry of evidence) {
            const first = Math.max(
              config.GUILD_TRIAL_FIRST_START_AT,
              config.GUILD_TRIAL_FIRST_START_AT +
                (Math.floor((entry.joinedAt - config.GUILD_TRIAL_FIRST_START_AT) / WEEK_MS) + 1) * WEEK_MS
            );
            const last = Math.min(latest, entry.observedAt);
            const expected = Math.max(0, Math.floor((last - first) / WEEK_MS) + 1);
            if (dates.filter((at) => at >= first && at <= last).length < expected) player[scope].incomplete = true;
          }
        }
      }
    }
    return [...players.values()]
      .filter(
        (player) =>
          player.participations ||
          player.skilling.count ||
          player.combat.count ||
          player.skilling.unknownWeeks ||
          player.combat.unknownWeeks
      )
      .map((player) => ({
        ...player,
        all: {
          count: player.skilling.count + player.combat.count,
          sampleCount: player.skilling.sampleCount + player.combat.sampleCount,
          unknownWeeks: player.skilling.unknownWeeks + player.combat.unknownWeeks,
          incomplete: player.skilling.incomplete || player.combat.incomplete,
          total:
            player.skilling.average === null
              ? player.combat.average
              : player.combat.average === null
                ? player.skilling.average
                : player.skilling.average + player.combat.average
        }
      }));
  }

  function playerProjectOverview(records, identity, details = {}) {
    const captured = records.filter((record) => record.schemaVersion === 1 && record.source !== "manual");
    const catalog = new Map();
    for (const [kind, names] of [
      ["skilling", config.GUILD_TRIAL_SKILL_ORDER],
      ["combat", config.GUILD_TRIAL_COMBAT_ORDER]
    ])
      for (const [index, name] of names.entries()) {
        const trialHrid = `/guild_${kind}/${name}`;
        catalog.set(trialHrid, { kind, trialHrid, trialDetail: { sortIndex: index } });
      }
    for (const [trialHrid, detail] of Object.entries(details)) {
      const kind = trialHrid.startsWith("/guild_skilling/")
        ? "skilling"
        : trialHrid.startsWith("/guild_combat/")
          ? "combat"
          : null;
      if (kind)
        catalog.set(trialHrid, { kind, trialHrid, trialDetail: { ...catalog.get(trialHrid)?.trialDetail, ...detail } });
    }
    for (const record of captured)
      catalog.set(record.trialHrid, {
        ...record,
        trialDetail: { ...catalog.get(record.trialHrid)?.trialDetail, ...record.trialDetail }
      });
    const groups = new Map(historyProjects(captured, details).map((group) => [group.key, group.records]));
    return historyProjects([...catalog.values()], details).map((group) => {
      const project = group.records[0];
      const player = participationRankings(groups.get(group.key) || []).find((entry) =>
        identity.id != null ? entry.id === String(identity.id) : entry.id === null && entry.name === identity.name
      );
      const average = player?.[group.kind].average ?? null;
      const samples = player?.all.count || 0;
      const total = average === null ? null : average * samples;
      return {
        key: group.key,
        kind: group.kind,
        trialHrid: project.trialHrid,
        trialDetail: details[project.trialHrid] || project.trialDetail,
        participations: player?.participations || 0,
        average,
        samples,
        total: Number.isFinite(total) ? total : null
      };
    });
  }

  function summarizePlayerProjects(projects) {
    const measured = projects.filter((project) => project.samples > 0 && Number.isFinite(project.average));
    const samples = measured.reduce((sum, project) => sum + project.samples, 0);
    const total = measured.reduce((sum, project) => sum + project.average * project.samples, 0);
    return {
      participations: projects.reduce((sum, project) => sum + project.participations, 0),
      samples,
      average: samples
        ? Number.isFinite(total)
          ? total / samples
          : measured.reduce((sum, project) => sum + project.average * (project.samples / samples), 0)
        : null,
      total: samples && Number.isFinite(total) ? total : null
    };
  }

  function sortEntries(entries, sort) {
    const result = [...entries];
    if (
      !sort ||
      ![
        "member",
        "level",
        "workDone",
        "workShare",
        "workMultiple",
        "damageDealt",
        "healingDone",
        "premitigatedDamageTaken",
        ...["damageDealt", "healingDone", "premitigatedDamageTaken"].flatMap((field) => [
          field + "Share",
          field + "Multiple"
        ])
      ].includes(sort.field)
    )
      return result;
    const combatDerived = /^(damageDealt|healingDone|premitigatedDamageTaken)(Share|Multiple)$/.exec(sort.field);
    const summaries = new Map();
    if (combatDerived)
      for (const { record } of result)
        if (!summaries.has(record)) summaries.set(record, summarizeMetric(record, combatDerived[1]));
    const value = ({ record, row }) =>
      combatDerived
        ? (combatDerived[2] === "Share" ? metricShare : metricAverageMultiple)(
            record,
            row,
            combatDerived[1],
            summaries.get(record)
          )
        : sort.field === "member"
          ? memberIdentity(record, row).name || null
          : sort.field === "level"
            ? memberLevel(record, row)
            : metricValue(record, row, ["workShare", "workMultiple"].includes(sort.field) ? "workDone" : sort.field);
    const direction = sort.direction === "asc" ? 1 : -1;
    return result.sort((a, b) => {
      const left = value(a),
        right = value(b);
      // Unknown values stay last in either direction; equal values retain source order.
      if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
      return direction * (sort.field === "member" ? memberCollator.compare(left, right) : left - right);
    });
  }

  function displayRows(record, sort = record.kind === "skilling" ? { field: "workDone", direction: "desc" } : null) {
    return sortEntries(
      record.rows.map((row) => ({ record, row })),
      sort
    ).map((entry) => entry.row);
  }

  function searchHistoryMembers(members, query) {
    const needle = String(query || "")
      .trim()
      .toLocaleLowerCase();
    return members.filter((member) => !needle || member.name.toLocaleLowerCase().includes(needle));
  }

  function previewImport(incoming, existing) {
    const byKey = new Map(existing.map((record) => [record.key, normalizeSnapshot(record)]));
    return incoming.map(normalizeSnapshot).map((record) => {
      const previous = byKey.get(record.key);
      let status = !previous
        ? "new"
        : contentSignature(previous) === contentSignature(record)
          ? "duplicate"
          : "conflict";
      if (status === "conflict" && validManualSnapshot(previous) && validManualSnapshot(record)) {
        const withoutDate = (value) => contentSignature({ ...value, trialDate: null, weekStartAt: null });
        if (withoutDate(previous) === withoutDate(record)) {
          if (previous.trialDate === null && record.trialDate !== null) status = "dated";
          // Reimporting an older file must not erase known dates.
          else if (previous.trialDate !== null && record.trialDate === null) status = "duplicate";
        }
      }
      return { record, status };
    });
  }

  return {
    historyProjectKey,
    historyProjects,
    historyWeeks,
    metricValue,
    summarizeMetric,
    metricShare,
    lowWorkShare,
    signupWorkWarnings,
    metricAverageMultiple,
    playerRankings,
    playerProjectOverview,
    summarizePlayerProjects,
    displayRows,
    sortEntries,
    memberAbsent,
    memberIdentity,
    memberHistory,
    historyMembers,
    searchHistoryMembers,
    sameMember,
    memberLevel,
    currentMemberJoinedAt,
    currentMembershipRankings,
    withMemberLevels,
    withMembershipEvidence,
    mergeMembershipEvidence,
    updateContext,
    completedSnapshots,
    nextTierProgress,
    withSavedProgress,
    validSnapshot,
    parseImport,
    previewImport,
    compareSnapshots,
    normalizeSnapshot,
    weekNumber,
    MAX_IMPORT_BYTES
  };
});


// SOURCE: src/runtime/profile-reader.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildProfileReader = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const keyFor = (name) => (typeof name === "string" ? name.trim().toLowerCase() : "");
  function profileIdentity(profile) {
    const character = profile?.sharableCharacter || {};
    const skills = Object.values(profile?.characterSkills || {});
    const id =
      character.id ??
      character.characterId ??
      profile?.characterId ??
      skills.find((skill) => skill?.characterId != null)?.characterId;
    return {
      id: id == null ? null : String(id),
      name: character.name || profile?.characterName || profile?.name || ""
    };
  }

  function createReader({ getController, setTimeout, clearTimeout }) {
    const cache = new Map();
    const hooks = new Map();
    const notify = (entry, result) => {
      for (const listener of entry.listeners) {
        try {
          listener(result);
        } catch (_) {
          /* Optional UI must not interrupt the game. */
        }
      }
    };
    function restore(controller, hook) {
      if (hook.pending.size) return;
      if (controller.setState === hook.intercept) {
        if (hook.own) controller.setState = hook.original;
        else delete controller.setState;
      }
      hooks.delete(controller);
    }
    function remember(profile) {
      const key = keyFor(profileIdentity(profile).name);
      if (!key) return;
      cache.delete(key);
      cache.set(key, profile);
      if (cache.size > 50) cache.delete(cache.keys().next().value);
    }
    function hookController(controller) {
      if (hooks.has(controller)) return hooks.get(controller);
      const hook = { pending: new Map(), original: controller.setState, own: Object.hasOwn(controller, "setState") };
      hook.intercept = function (update, callback) {
        // The official profile_shared handler supplies this object. All unrelated
        // and functional state updates pass through unchanged.
        const profile = update && typeof update === "object" ? update.sharableProfile : null;
        const key = keyFor(profileIdentity(profile).name);
        const entry = profile && hook.pending.get(key);
        if (!entry) return hook.original.apply(this, arguments);
        hook.pending.delete(key);
        clearTimeout(entry.timeout);
        clearTimeout(entry.cleanup);
        remember(profile);
        const rest = { ...update };
        delete rest.sharableProfile;
        delete rest.sharableGuildProfile;
        restore(controller, hook);
        if (Object.keys(rest).length) hook.original.call(this, rest, callback);
        else if (typeof callback === "function") callback.call(this);
        notify(entry, { status: "ready", profile });
      };
      controller.setState = hook.intercept;
      if (controller.setState !== hook.intercept) return null;
      hooks.set(controller, hook);
      return hook;
    }
    function request(name, listener, force = false) {
      const characterName = typeof name === "string" ? name.trim() : "";
      if (
        !characterName ||
        characterName.length > 64 ||
        /[\u0000-\u001f\u007f]/.test(characterName) ||
        typeof listener !== "function"
      )
        return false;
      const key = keyFor(characterName);
      try {
        const controller = getController();
        const pending = hooks.get(controller)?.pending.get(key);
        if (pending && !(force && pending.timedOut)) {
          pending.listeners.add(listener);
          if (pending.timedOut) listener({ status: "timeout" });
          return true;
        }
        if (!force) {
          const current = controller?.state?.sharableProfile;
          if (!cache.has(key) && keyFor(profileIdentity(current).name) === key) remember(current);
          if (cache.has(key)) {
            listener({ status: "ready", profile: cache.get(key) });
            return true;
          }
        }
        if (!controller || typeof controller.setState !== "function") return false;
        const hook = hookController(controller);
        if (!hook) return false;
        const previous = hook.pending.get(key);
        if (previous) {
          clearTimeout(previous.timeout);
          clearTimeout(previous.cleanup);
        }
        const entry = { listeners: new Set([listener]) };
        hook.pending.set(key, entry);
        entry.timeout = setTimeout(() => {
          entry.timedOut = true;
          notify(entry, { status: "timeout" });
        }, 15000);
        // A late response from our request must not flash a native modal. Keep a
        // bounded grace period, then restore the controller even if no reply arrives.
        entry.cleanup = setTimeout(() => {
          clearTimeout(entry.timeout);
          hook.pending.delete(key);
          restore(controller, hook);
        }, 60000);
        try {
          controller.handleViewProfile(characterName);
        } catch (_) {
          entry.timedOut = true;
          notify(entry, { status: "unavailable" });
        }
        return true;
      } catch (_) {
        return false;
      }
    }
    function dispose() {
      for (const [controller, hook] of hooks) {
        for (const entry of hook.pending.values()) {
          clearTimeout(entry.timeout);
          clearTimeout(entry.cleanup);
        }
        hook.pending.clear();
        restore(controller, hook);
      }
      cache.clear();
    }
    return { request, dispose };
  }
  return { createReader, profileIdentity };
});


// SOURCE: src/runtime/profile-tooltips.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildProfileTooltips = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function componentClass(type) {
    const seen = new Set();
    while (type && !seen.has(type)) {
      seen.add(type);
      if (type.prototype?.render) return type;
      type = type.WrappedComponent || type.type;
    }
    return null;
  }

  function findElement(tree, predicate) {
    const pending = [tree];
    while (pending.length) {
      const element = pending.pop();
      if (Array.isArray(element)) pending.push(...element);
      else if (element && typeof element === "object") {
        if (predicate(element)) return element;
        pending.push(element.props?.children);
      }
    }
    return null;
  }

  // Reuse the installed game's renderers, never copy its XP/strengthening/effect formulas.
  // Unwrap only the native profile's read-only components, with fresh explicit props.
  function tooltipContent(controller, profile, kind, record) {
    if (typeof controller?.renderSharableProfile !== "function" || typeof controller.props?.t !== "function")
      return null;
    const copy = {
      ...profile,
      characterSkills: Object.values(profile.characterSkills || {}).map((entry) => ({ ...entry })),
      equippedAbilities: Object.values(profile.equippedAbilities || {}).map((entry) => ({ ...entry }))
    };
    const element = controller.renderSharableProfile.call({ state: { sharableProfile: copy } });
    const Profile = componentClass(element?.type);
    if (!Profile) return null;
    const props = { profile: copy, t: controller.props.t };
    const instance = new Profile(props);
    let tree;
    if (kind === "skill") tree = instance.renderSkillsTab?.();
    else if (kind === "item" || kind === "ability") tree = instance.renderEquipmentTab?.();
    else return null;
    const field = { skill: "skillHrid", item: "itemHrid", ability: "abilityHrid" }[kind];
    const template = findElement(tree, (entry) => entry.props?.[field] === record[field]);
    const Component = componentClass(template?.type);
    if (!Component) return null;
    const nativeProps = { ...template.props, ...record, t: props.t };
    // Never inherit action handlers or player equipment state from a live component.
    for (const key of Object.keys(nativeProps)) if (/Handler$/.test(key)) delete nativeProps[key];
    const native = new Component(nativeProps);
    if (kind === "skill") return native.renderTooltipContent?.() || null;
    if (kind === "ability") return native.renderTooltip?.() || null;
    const tooltip = findElement(native.render(), (entry) => entry.props?.itemHrid === record.itemHrid);
    const Tooltip = componentClass(tooltip?.type);
    return Tooltip ? new Tooltip({ ...tooltip.props, t: props.t }).renderTooltipContent?.() || null : null;
  }

  function createRenderer({ page, getController }) {
    let reactDOM = null;
    const mounted = new Set();
    function resolveReactDOM() {
      if (reactDOM) return reactDOM;
      const queue = page.webpackJsonprpg_web;
      if (!Array.isArray(queue) || queue.push === Array.prototype.push) return null;
      // Webpack 4 exposes no public require. Register one isolated local module to
      // inspect already-loaded exports; do not execute or replace any game module.
      const id = `mwi-profile-tooltip-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      let runtime;
      queue.push([
        [],
        {
          [id]: (_module, _exports, require) => {
            runtime = require;
          }
        },
        [[id]]
      ]);
      if (!runtime) return null;
      try {
        for (const module of Object.values(runtime.c || {})) {
          const value = module?.exports;
          if (typeof value?.render === "function" && typeof value?.unmountComponentAtNode === "function") {
            reactDOM = value;
            break;
          }
        }
      } finally {
        delete runtime.c?.[id];
        delete runtime.m?.[id];
      }
      return reactDOM;
    }
    function clear(container) {
      if (!mounted.delete(container)) return;
      try {
        reactDOM?.unmountComponentAtNode(container);
      } catch (_) {
        /* Optional tooltip. */
      }
    }
    function render(container, profile, kind, record) {
      clear(container);
      try {
        const content = tooltipContent(getController(), profile, kind, record);
        const renderer = content && resolveReactDOM();
        if (!renderer) return false;
        mounted.add(container);
        renderer.render(content, container);
        return true;
      } catch (_) {
        clear(container);
        return false;
      }
    }
    function dispose() {
      for (const container of mounted) clear(container);
    }
    return { render, clear, dispose };
  }
  return { componentClass, tooltipContent, createRenderer };
});


// SOURCE: src/bridge.js
(function () {
  "use strict";

  const page = typeof unsafeWindow === "undefined" ? window : unsafeWindow;
  const marketDataApi = page.MwiGuildCreditMarketData || window.MwiGuildCreditMarketData;
  const marketDomApi = page.MwiGuildCreditMarketDom || window.MwiGuildCreditMarketDom;
  // The development loader starts in the page before this runtime is fetched.
  // Reuse its buffer and sockets even when the userscript window is isolated.
  const loaderBridge = Array.isArray(page.__mwiGuildCreditBridge?.sockets) ? page.__mwiGuildCreditBridge : null;
  const bridge =
    window.__mwiGuildCreditBridge ||
    (window.__mwiGuildCreditBridge = loaderBridge || {
      messages: [],
      itemDetails: null,
      guildBuffDetails: null,
      guildBuffLevels: null,
      guildShrineLevels: null,
      guildShrineDetails: null,
      guildBuildingLevels: null,
      guildBuildingDetails: null,
      guildPointSummary: null,
      guildWeekStartAt: null,
      guildCurrentWeekPoints: null,
      characterItems: null,
      characterItemsRevision: 0,
      guildBuffLevelsRevision: 0,
      guildPointSummaryRevision: 0,
      marketOrderBooks: Object.create(null),
      marketOrderBookRevision: 0
    });
  if (!("guildBuildingLevels" in bridge)) bridge.guildBuildingLevels = null;
  if (!("guildBuildingDetails" in bridge)) bridge.guildBuildingDetails = null;
  if (!("guildPointSummary" in bridge)) bridge.guildPointSummary = null;
  if (!("guildWeekStartAt" in bridge)) bridge.guildWeekStartAt = null;
  if (!("guildCurrentWeekPoints" in bridge)) bridge.guildCurrentWeekPoints = null;
  if (!bridge.marketOrderBooks || typeof bridge.marketOrderBooks !== "object")
    bridge.marketOrderBooks = Object.create(null);
  if (!Number.isSafeInteger(bridge.marketOrderBookRevision)) bridge.marketOrderBookRevision = 0;
  if (!Number.isSafeInteger(bridge.characterItemsRevision)) bridge.characterItemsRevision = 0;
  if (!Number.isSafeInteger(bridge.guildBuffLevelsRevision)) bridge.guildBuffLevelsRevision = 0;
  if (!Number.isSafeInteger(bridge.guildPointSummaryRevision)) bridge.guildPointSummaryRevision = 0;
  if (bridge.marketObserverActive !== true) bridge.marketObserverActive = false;
  bridge.trialHistoryContext = bridge.trialHistoryContext || {};
  bridge.pendingTrialSnapshots = bridge.pendingTrialSnapshots || [];

  const SOCKET_MESSAGE_EVENT = "__mwiGuildCreditSocketMessageV1";
  const SOCKET_READY_EVENT = "__mwiGuildCreditSocketReadyV1";
  const DIAGNOSTICS_ATTRIBUTE = "data-mwi-credit-bridge-diagnostics";
  const diagnostics =
    bridge.diagnostics && typeof bridge.diagnostics === "object"
      ? bridge.diagnostics
      : (bridge.diagnostics = {
          scriptStartedAt: Date.now(),
          injectionAttempted: false,
          injectionReady: false,
          installMode: "initializing",
          observerActive: false,
          messageCount: 0,
          lastMessageAt: 0,
          lastMessageType: "",
          lastCharacterItemsUpdatedAt: 0,
          lastCharacterItemsSource: "",
          lastGuildBuffLevelsUpdatedAt: 0,
          lastMarketItemHrid: "",
          lastMarketLevels: null,
          lastMarketReceivedAt: 0,
          lastMarketSource: "",
          domObserverActive: false,
          domSnapshotCount: 0
        });

  function publishBridgeDiagnostics() {
    const documentRef = window.document;
    const root = documentRef && documentRef.documentElement;
    if (!root || typeof root.setAttribute !== "function") return false;
    try {
      root.setAttribute(
        DIAGNOSTICS_ATTRIBUTE,
        JSON.stringify({
          ...diagnostics,
          trialRosterCount: Object.keys(bridge.trialHistoryContext.roster || {}).length,
          trialMembershipEvidenceCount: bridge.trialHistoryContext.membershipEvidence?.length || 0,
          characterItemsRevision: bridge.characterItemsRevision,
          guildBuffLevelsRevision: bridge.guildBuffLevelsRevision,
          guildPointSummaryRevision: bridge.guildPointSummaryRevision,
          marketOrderBookRevision: bridge.marketOrderBookRevision
        })
      );
      return true;
    } catch (_) {
      return false;
    }
  }
  publishBridgeDiagnostics();
  if (window.document && !window.document.documentElement && typeof window.addEventListener === "function") {
    window.addEventListener("DOMContentLoaded", publishBridgeDiagnostics, { once: true });
  }

  function keepMarketData(message, source) {
    if (!marketDataApi || !message || String(message.type || "") !== "market_item_order_books_updated") return;
    const update = marketDataApi.normalizeMarketOrderBooksUpdate(message);
    if (!update) return;
    const normalizedSource = source === "market_dom" ? "market_dom" : "websocket";
    const receivedAt = Date.now();
    const revision = Math.min(Number.MAX_SAFE_INTEGER, bridge.marketOrderBookRevision + 1);
    bridge.marketOrderBookRevision = revision;
    bridge.marketOrderBooks[update.itemHrid] = {
      update,
      revision,
      receivedAt,
      source: normalizedSource
    };
    diagnostics.lastMarketItemHrid = update.itemHrid;
    diagnostics.lastMarketLevels = update.levels;
    diagnostics.lastMarketReceivedAt = receivedAt;
    diagnostics.lastMarketSource = normalizedSource;
    publishBridgeDiagnostics();
    if (typeof bridge.onMarketOrderBooksUpdated === "function") {
      try {
        bridge.onMarketOrderBooksUpdated();
      } catch (_) {
        // The observer is optional and must never affect the game socket.
      }
    }
  }

  function isGameWebSocketUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "wss:" && /^api(?:-test)?\.milkywayidle(?:cn)?\.com$/i.test(url.hostname);
    } catch (_) {
      return false;
    }
  }

  // The game owns the market navigation state. Reuse its controller instead
  // of reconstructing navigation and the market search field in the plugin.
  // React keeps this controller private, so resolve it only when the player
  // clicks one of our item links; never retain a stale component instance.
  function reactFiberRoots() {
    const documentRef = page.document;
    const root = documentRef && documentRef.getElementById && documentRef.getElementById("root");
    if (!root) return [];
    const roots = [];
    const append = (value) => {
      if (value && typeof value === "object") roots.push(value);
    };
    for (const key of Object.getOwnPropertyNames(root)) {
      if (key.startsWith("__reactContainer$") || key.startsWith("__reactFiber$")) append(root[key]);
    }
    append(root._reactRootContainer);
    append(root._reactRootContainer && root._reactRootContainer._internalRoot);
    return roots;
  }

  function findGameController(methodName) {
    const pending = reactFiberRoots();
    const visited = new Set();
    let inspected = 0;
    while (pending.length && inspected < 50000) {
      const fiber = pending.pop();
      if (!fiber || typeof fiber !== "object" || visited.has(fiber)) continue;
      visited.add(fiber);
      inspected += 1;
      const stateNode = fiber.stateNode;
      if (stateNode && typeof stateNode[methodName] === "function") return stateNode;
      if (fiber.current) pending.push(fiber.current);
      if (fiber.child) pending.push(fiber.child);
      if (fiber.sibling) pending.push(fiber.sibling);
      if (fiber.alternate) pending.push(fiber.alternate);
    }
    return null;
  }

  bridge.goToMarketplace = function (itemHrid, enhancementLevel) {
    if (typeof itemHrid !== "string" || !itemHrid.startsWith("/items/")) return false;
    const controller = findGameController("handleGoToMarketplace");
    if (!controller) return false;
    // The native item UI always supplies a numeric level (0 for ordinary
    // materials). An undefined level builds an invalid market order-book key
    // and can make the game's market renderer fail before it can recover.
    const normalizedEnhancementLevel =
      Number.isInteger(enhancementLevel) && enhancementLevel >= 0 ? enhancementLevel : 0;
    try {
      controller.handleGoToMarketplace(itemHrid, normalizedEnhancementLevel);
      return true;
    } catch (_) {
      return false;
    }
  };

  const profileReaderApi = window.MwiGuildProfileReader || page.MwiGuildProfileReader;
  const profileReader = profileReaderApi?.createReader({
    getController: () => findGameController("handleViewProfile"),
    setTimeout: (...args) => window.setTimeout(...args),
    clearTimeout: (timer) => window.clearTimeout(timer)
  });
  bridge.requestProfile = (name, listener, force = false) => profileReader?.request(name, listener, force) === true;
  bridge.disposeProfileReader = () => profileReader?.dispose();
  const profileTooltipsApi = window.MwiGuildProfileTooltips || page.MwiGuildProfileTooltips;
  const profileTooltips = profileTooltipsApi?.createRenderer({
    page,
    getController: () => findGameController("renderSharableProfile")
  });
  bridge.renderProfileTooltip = (...args) => profileTooltips?.render(...args) === true;
  bridge.clearProfileTooltip = (container) => profileTooltips?.clear(container);

  function levelRecordKey(record, fallbackKey) {
    if (record && typeof record === "object") {
      const explicitKey = record.guildShrineHrid || record.shrineHrid || record.guildBuildingHrid || record.hrid;
      if (typeof explicitKey === "string" && explicitKey) return explicitKey;
    }
    return String(fallbackKey || "");
  }

  // Guild-building snapshots can arrive in separate WebSocket frames. Keep a
  // union keyed by the game's own HRID instead of replacing a complete
  // snapshot with a later, partial update.
  function mergeGuildShrineLevels(previous, incoming) {
    if (!incoming || typeof incoming !== "object") return previous;
    const merged = Object.create(null);
    const append = (source) => {
      const entries = Array.isArray(source)
        ? source.map((record, index) => [levelRecordKey(record, index), record])
        : Object.entries(source || {});
      for (const [fallbackKey, record] of entries) {
        const key = levelRecordKey(record, fallbackKey);
        if (key) merged[key] = record;
      }
    };
    append(previous);
    append(incoming);
    return merged;
  }

  function characterItemKey(record) {
    if (!record || typeof record !== "object") return "";
    if (typeof record.hash === "string" && record.hash) return `hash:${record.hash}`;
    if (typeof record.itemHrid !== "string" || !record.itemHrid.startsWith("/items/")) return "";
    if (typeof record.itemLocationHrid !== "string" || !record.itemLocationHrid.startsWith("/item_locations/"))
      return "";
    const enhancementLevel = Number(record.enhancementLevel) || 0;
    return `stack:${record.itemLocationHrid}::${record.itemHrid}::${enhancementLevel}`;
  }

  function characterItemCount(record) {
    const count = Number(record && record.count);
    return Number.isFinite(count) ? count : null;
  }

  function characterItemsEqual(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    const leftCounts = new Map();
    for (const record of left) {
      const key = characterItemKey(record);
      const count = characterItemCount(record);
      if (key && count !== null) leftCounts.set(key, count);
    }
    if (leftCounts.size !== right.length) return false;
    for (const record of right) {
      const key = characterItemKey(record);
      const count = characterItemCount(record);
      if (!key || count === null || leftCounts.get(key) !== count) return false;
    }
    return true;
  }

  function replaceCharacterItems(incoming) {
    if (!Array.isArray(incoming)) return false;
    const next = incoming.filter((record) => {
      const count = characterItemCount(record);
      return characterItemKey(record) && count !== null && count !== 0;
    });
    if (characterItemsEqual(bridge.characterItems, next)) return false;
    bridge.characterItems = next;
    return true;
  }

  // Runtime inventory changes arrive as endCharacterItems. The game applies
  // those records by stack hash and deletes a stack when its count reaches 0.
  function mergeCharacterItems(incoming) {
    if (!Array.isArray(incoming) || !incoming.length) return false;
    const itemMap = new Map();
    for (const record of bridge.characterItems || []) {
      const key = characterItemKey(record);
      if (key) itemMap.set(key, record);
    }
    for (const record of incoming) {
      const key = characterItemKey(record);
      const count = characterItemCount(record);
      if (!key || count === null) continue;
      if (count === 0) itemMap.delete(key);
      else itemMap.set(key, record);
    }
    const next = Array.from(itemMap.values());
    if (characterItemsEqual(bridge.characterItems, next)) return false;
    bridge.characterItems = next;
    return true;
  }

  function publishCharacterItemsUpdate(source) {
    bridge.characterItemsRevision = Math.min(Number.MAX_SAFE_INTEGER, bridge.characterItemsRevision + 1);
    diagnostics.lastCharacterItemsUpdatedAt = Date.now();
    diagnostics.lastCharacterItemsSource = source;
    publishBridgeDiagnostics();
    if (typeof bridge.onCharacterItemsUpdated === "function") {
      try {
        bridge.onCharacterItemsUpdated();
      } catch (_) {
        // The observer is optional and must never affect the game socket.
      }
    }
  }

  function recordSignature(value) {
    try {
      return JSON.stringify(value || null);
    } catch (_) {
      return "";
    }
  }

  function publishGuildBuffLevelsUpdate() {
    bridge.guildBuffLevelsRevision = Math.min(Number.MAX_SAFE_INTEGER, bridge.guildBuffLevelsRevision + 1);
    diagnostics.lastGuildBuffLevelsUpdatedAt = Date.now();
    publishBridgeDiagnostics();
    if (typeof bridge.onGuildBuffLevelsUpdated === "function") {
      try {
        bridge.onGuildBuffLevelsUpdated();
      } catch (_) {
        // The observer is optional and must never affect the game socket.
      }
    }
  }

  function publishGuildPointSummaryUpdate() {
    bridge.guildPointSummaryRevision = Math.min(Number.MAX_SAFE_INTEGER, bridge.guildPointSummaryRevision + 1);
    publishBridgeDiagnostics();
    if (typeof bridge.onGuildPointSummaryUpdated === "function") {
      try {
        bridge.onGuildPointSummaryUpdated();
      } catch (_) {
        // The observer is optional and must never affect the game socket.
      }
    }
  }

  function weekStartTimestamp(value) {
    const numeric = Number(value);
    if (Number.isSafeInteger(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }

  function keepGuildData(message) {
    if (!message || typeof message !== "object") return;
    const visited = new Set();
    const pending = [message];
    let scanned = 0;
    let characterItemsChanged = false;
    let characterItemsSource = "";
    const previousGuildBuffLevelsSignature = recordSignature(bridge.guildBuffLevels);
    const previousGuildPointSummarySignature = recordSignature([bridge.guildPointSummary, bridge.guildWeekStartAt]);
    while (pending.length && scanned < 400) {
      const value = pending.pop();
      if (!value || typeof value !== "object" || visited.has(value)) continue;
      visited.add(value);
      scanned += 1;
      const itemDetails = value.itemDetailMap || value.itemDetailDict;
      const guildBuffDetails = value.guildBuffDetailMap || value.guildBuffDetailDict;
      const guildBuffLevels =
        value.characterGuildBuffMap ||
        value.characterGuildBuffDict ||
        value.characterGuildBuffs ||
        value.characterGuildBuffLevelMap ||
        value.characterGuildBuffLevelDict;
      const guildShrineLevelCandidates = [
        value.guildShrineMap,
        value.guildShrineDict,
        value.guildShrines,
        value.guildShrineLevelMap,
        value.guildShrineLevelDict,
        value.guildShrineLevels,
        value.guildBuildingMap,
        value.guildBuildingDict,
        value.guildBuildings,
        value.guildBuildingLevelMap,
        value.guildBuildingLevelDict,
        value.guildBuildingLevels
      ];
      const guildBuildingLevelCandidates = [
        value.guildBuildingMap,
        value.guildBuildingDict,
        value.guildBuildings,
        value.guildBuildingLevelMap,
        value.guildBuildingLevelDict,
        value.guildBuildingLevels
      ];
      const guildShrineDetailCandidates = [
        value.guildShrineDetailMap,
        value.guildShrineDetailDict,
        value.guildShrineDetails,
        value.guildBuildingDetailMap,
        value.guildBuildingDetailDict,
        value.guildBuildingDetails
      ];
      const guildBuildingDetailCandidates = [
        value.guildBuildingDetailMap,
        value.guildBuildingDetailDict,
        value.guildBuildingDetails
      ];
      const characterItems = value.characterItems;
      const endCharacterItems = value.endCharacterItems;
      const lifetimeGuildPoints = Number(value.lifetimeGuildPoints);
      const guildPoints = Number(value.guildPoints);
      const guildWeekStartAt = weekStartTimestamp(value.currentWeekStartAt);
      const guildId = String(value.guildID || value.guildId || value.id || bridge.guildPointSummary?.guildId || "");
      const hasGuildBalance =
        Number.isSafeInteger(lifetimeGuildPoints) &&
        lifetimeGuildPoints >= 0 &&
        Number.isSafeInteger(guildPoints) &&
        guildPoints >= 0;
      const guildChanged =
        hasGuildBalance && bridge.guildPointSummary?.guildId && guildId && bridge.guildPointSummary.guildId !== guildId;
      const staleGuildWeek =
        !guildChanged && guildWeekStartAt && bridge.guildWeekStartAt && guildWeekStartAt < bridge.guildWeekStartAt;
      if (itemDetails && typeof itemDetails === "object") bridge.itemDetails = itemDetails;
      if (guildBuffDetails && typeof guildBuffDetails === "object") bridge.guildBuffDetails = guildBuffDetails;
      if (guildBuffLevels && typeof guildBuffLevels === "object") bridge.guildBuffLevels = guildBuffLevels;
      for (const guildShrineLevels of guildShrineLevelCandidates) {
        if (guildShrineLevels && typeof guildShrineLevels === "object") {
          bridge.guildShrineLevels = mergeGuildShrineLevels(bridge.guildShrineLevels, guildShrineLevels);
        }
      }
      for (const guildBuildingLevels of guildBuildingLevelCandidates) {
        if (guildBuildingLevels && typeof guildBuildingLevels === "object") {
          bridge.guildBuildingLevels = mergeGuildShrineLevels(bridge.guildBuildingLevels, guildBuildingLevels);
        }
      }
      for (const guildShrineDetails of guildShrineDetailCandidates) {
        if (guildShrineDetails && typeof guildShrineDetails === "object") {
          bridge.guildShrineDetails = mergeGuildShrineLevels(bridge.guildShrineDetails, guildShrineDetails);
        }
      }
      for (const guildBuildingDetails of guildBuildingDetailCandidates) {
        if (guildBuildingDetails && typeof guildBuildingDetails === "object") {
          bridge.guildBuildingDetails = mergeGuildShrineLevels(bridge.guildBuildingDetails, guildBuildingDetails);
        }
      }
      if (Array.isArray(characterItems) && replaceCharacterItems(characterItems)) {
        characterItemsChanged = true;
        characterItemsSource = "snapshot";
      }
      if (Array.isArray(endCharacterItems) && mergeCharacterItems(endCharacterItems)) {
        characterItemsChanged = true;
        characterItemsSource = "incremental";
      }
      if (guildChanged || (!staleGuildWeek && guildWeekStartAt && guildWeekStartAt !== bridge.guildWeekStartAt)) {
        bridge.guildCurrentWeekPoints = null;
        bridge.guildWeekStartAt = guildWeekStartAt;
        if (bridge.guildPointSummary) {
          bridge.guildPointSummary = { ...bridge.guildPointSummary };
          delete bridge.guildPointSummary.currentWeekPoints;
        }
      }
      if (hasGuildBalance && !staleGuildWeek) {
        bridge.guildPointSummary = {
          guildId,
          lifetimePoints: lifetimeGuildPoints,
          availablePoints: guildPoints,
          ...(Number.isSafeInteger(bridge.guildCurrentWeekPoints)
            ? { currentWeekPoints: bridge.guildCurrentWeekPoints }
            : {})
        };
      }
      // A balance is never a weekly earning, including on dated guild objects.
      const rawWeekPoints = value.currentWeekGuildPoints ?? value.currentWeekPoints ?? value.weeklyGuildPoints;
      const currentWeekGuildPoints =
        typeof rawWeekPoints === "number" || (typeof rawWeekPoints === "string" && rawWeekPoints.trim())
          ? Number(rawWeekPoints)
          : NaN;
      if (!staleGuildWeek && Number.isSafeInteger(currentWeekGuildPoints) && currentWeekGuildPoints >= 0) {
        bridge.guildCurrentWeekPoints = currentWeekGuildPoints;
        if (bridge.guildPointSummary)
          bridge.guildPointSummary = { ...bridge.guildPointSummary, currentWeekPoints: currentWeekGuildPoints };
      }
      for (const child of Object.values(value)) pending.push(child);
    }
    if (characterItemsChanged) publishCharacterItemsUpdate(characterItemsSource);
    if (recordSignature(bridge.guildBuffLevels) !== previousGuildBuffLevelsSignature) publishGuildBuffLevelsUpdate();
    if (recordSignature([bridge.guildPointSummary, bridge.guildWeekStartAt]) !== previousGuildPointSummarySignature)
      publishGuildPointSummaryUpdate();
  }

  function keepSocketMessage(rawMessage, bufferMessage = true) {
    if (typeof rawMessage !== "string") return;
    if (bufferMessage) {
      bridge.messages.push(rawMessage);
      if (bridge.messages.length > 80) bridge.messages.shift();
    }
    diagnostics.messageCount = Math.min(Number.MAX_SAFE_INTEGER, diagnostics.messageCount + 1);
    diagnostics.lastMessageAt = Date.now();
    try {
      const message = JSON.parse(rawMessage);
      diagnostics.lastMessageType = String((message && message.type) || "");
      keepMarketData(message, "websocket");
      keepGuildData(message);
      const trialApi = window.MwiGuildTrialHistory;
      if (trialApi) {
        const previousContext = bridge.trialHistoryContext;
        bridge.trialHistoryContext = trialApi.updateContext(bridge.trialHistoryContext, message);
        const snapshots = trialApi.completedSnapshots(bridge.trialHistoryContext, message);
        if (snapshots.length) bridge.pendingTrialSnapshots.push(...snapshots);
        const membershipChanged =
          previousContext.guild !== bridge.trialHistoryContext.guild ||
          previousContext.roster !== bridge.trialHistoryContext.roster ||
          previousContext.signups !== bridge.trialHistoryContext.signups ||
          previousContext.signupLevels !== bridge.trialHistoryContext.signupLevels;
        if ((snapshots.length || membershipChanged) && typeof bridge.onTrialStatsUpdated === "function")
          bridge.onTrialStatsUpdated();
      }
    } catch (_) {
      diagnostics.lastMessageType = "non_json";
      // Ignore non-JSON protocol frames.
    }
    publishBridgeDiagnostics();
  }

  let lastMarketDomSignature = "";
  let marketDomScanScheduled = false;
  let marketDomObserver = null;

  function currentWeekGuildPointsFromDom(documentRef) {
    if (!documentRef || typeof documentRef.querySelectorAll !== "function") return null;
    const patterns = [
      /^本週公會點數\s*[:：]\s*([\d,]+)$/,
      /^(?:Guild Points This Week|This Week(?:'s)? Guild Points)\s*[:：]\s*([\d,]+)$/i
    ];
    for (const element of documentRef.querySelectorAll("div, span, p")) {
      const text = String(element && element.textContent ? element.textContent : "")
        .replace(/\s+/g, " ")
        .trim();
      if (!text || text.length > 80) continue;
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (!match) continue;
        const points = Number(match[1].replaceAll(",", ""));
        if (Number.isSafeInteger(points) && points >= 0) return points;
      }
    }
    return null;
  }

  function scanMarketDom() {
    marketDomScanScheduled = false;
    let changed = false;
    if (marketDomApi && typeof marketDomApi.readMarketDomSnapshot === "function") {
      const snapshot = marketDomApi.readMarketDomSnapshot(window.document);
      if (snapshot && snapshot.signature !== lastMarketDomSignature) {
        const message = marketDomApi.createMarketMessage(snapshot);
        if (message) {
          lastMarketDomSignature = snapshot.signature;
          diagnostics.domSnapshotCount = Math.min(Number.MAX_SAFE_INTEGER, diagnostics.domSnapshotCount + 1);
          keepMarketData(message, "market_dom");
          changed = true;
        }
      }
    }
    const currentWeekPoints = currentWeekGuildPointsFromDom(window.document);
    if (currentWeekPoints !== null && currentWeekPoints !== bridge.guildCurrentWeekPoints) {
      bridge.guildCurrentWeekPoints = currentWeekPoints;
      if (bridge.guildPointSummary) bridge.guildPointSummary = { ...bridge.guildPointSummary, currentWeekPoints };
      diagnostics.domSnapshotCount = Math.min(Number.MAX_SAFE_INTEGER, diagnostics.domSnapshotCount + 1);
      publishGuildPointSummaryUpdate();
      changed = true;
    }
    return changed;
  }

  function scheduleMarketDomScan() {
    if (marketDomScanScheduled) return;
    marketDomScanScheduled = true;
    const schedule = typeof window.setTimeout === "function" ? window.setTimeout.bind(window) : setTimeout;
    schedule(scanMarketDom, 40);
  }

  function installMarketDomObserver() {
    if (marketDomObserver || !window.document) return false;
    const root = window.document.documentElement;
    const Observer = window.MutationObserver || (typeof MutationObserver === "function" ? MutationObserver : null);
    if (!root || typeof Observer !== "function") return false;
    marketDomObserver = new Observer(scheduleMarketDomScan);
    marketDomObserver.observe(root, { subtree: true, childList: true, characterData: true });
    bridge.marketDomObserverActive = true;
    diagnostics.domObserverActive = true;
    publishBridgeDiagnostics();
    scheduleMarketDomScan();
    return true;
  }

  if (!installMarketDomObserver() && typeof window.addEventListener === "function") {
    window.addEventListener("DOMContentLoaded", installMarketDomObserver, { once: true });
  }

  // Tampermonkey can expose unsafeWindow through an isolated-world proxy whose
  // expando assignments do not replace the game's real globals. Inject the
  // socket wrapper into MAIN_WORLD and carry only string payloads back through
  // DOM events, which are shared across the two worlds.
  function installPageSocketTap(messageEventName, readyEventName) {
    const dispatchReady = (active) => {
      window.dispatchEvent(new CustomEvent(readyEventName, { detail: active ? "1" : "0" }));
    };
    const NativeWebSocket = window.WebSocket;
    if (typeof NativeWebSocket !== "function") {
      dispatchReady(false);
      return;
    }
    if (NativeWebSocket.__mwiGuildCreditBridge === true) {
      dispatchReady(true);
      return;
    }
    const instrumentedSockets = new WeakSet();
    const isOfficialSocket = (value) => {
      try {
        const url = new URL(String(value || ""));
        return url.protocol === "wss:" && /^api(?:-test)?\.milkywayidle(?:cn)?\.com$/i.test(url.hostname);
      } catch (_) {
        return false;
      }
    };
    const instrumentSocket = (socket) => {
      if (
        !socket ||
        !isOfficialSocket(socket.url) ||
        typeof socket.addEventListener !== "function" ||
        instrumentedSockets.has(socket)
      ) {
        return socket;
      }
      instrumentedSockets.add(socket);
      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return;
        window.dispatchEvent(new CustomEvent(messageEventName, { detail: event.data }));
      });
      return socket;
    };
    function ObservedWebSocket(...args) {
      return instrumentSocket(new NativeWebSocket(...args));
    }
    ObservedWebSocket.prototype = NativeWebSocket.prototype;
    try {
      Object.setPrototypeOf(ObservedWebSocket, NativeWebSocket);
    } catch (_) {
      // Static WebSocket constants are copied below when inheritance is blocked.
    }
    for (const constant of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) {
      if (constant in ObservedWebSocket) continue;
      try {
        Object.defineProperty(ObservedWebSocket, constant, {
          configurable: true,
          enumerable: true,
          value: NativeWebSocket[constant]
        });
      } catch (_) {
        // Missing constants do not affect socket construction or observation.
      }
    }
    Object.defineProperty(ObservedWebSocket, "__mwiGuildCreditBridge", { value: true });
    try {
      window.WebSocket = ObservedWebSocket;
      dispatchReady(window.WebSocket === ObservedWebSocket);
    } catch (_) {
      dispatchReady(false);
    }
  }

  let pageSocketTapInstalled = false;
  if (typeof window.addEventListener === "function") {
    window.addEventListener(SOCKET_MESSAGE_EVENT, (event) => {
      keepSocketMessage(event && event.detail);
    });
    window.addEventListener(
      SOCKET_READY_EVENT,
      (event) => {
        pageSocketTapInstalled = Boolean(event && event.detail === "1");
        diagnostics.injectionReady = pageSocketTapInstalled;
        diagnostics.installMode = pageSocketTapInstalled ? "gm_add_element_main_world" : "gm_add_element_rejected";
        diagnostics.observerActive = pageSocketTapInstalled;
        publishBridgeDiagnostics();
      },
      { once: true }
    );
  }
  if (typeof GM_addElement === "function" && !loaderBridge) {
    diagnostics.injectionAttempted = true;
    diagnostics.installMode = "gm_add_element_pending";
    publishBridgeDiagnostics();
    try {
      const source = `;(${installPageSocketTap.toString()})(${JSON.stringify(SOCKET_MESSAGE_EVENT)},${JSON.stringify(SOCKET_READY_EVENT)});`;
      const injected = GM_addElement("script", { textContent: source });
      if (injected && typeof injected.remove === "function") injected.remove();
    } catch (error) {
      diagnostics.installMode = "gm_add_element_error";
      diagnostics.injectionError = String((error && error.message) || error || "unknown");
      publishBridgeDiagnostics();
      // Fall back to unsafeWindow for userscript managers without GM_addElement.
    }
  }
  if (pageSocketTapInstalled) {
    bridge.marketObserverActive = true;
    diagnostics.observerActive = true;
    publishBridgeDiagnostics();
    return;
  }

  const NativeWebSocket = page.WebSocket;
  const adoptLoader =
    NativeWebSocket?.__mwiGuildCreditBridge && loaderBridge === bridge && !bridge.runtimeSocketObserverActive;
  if (!NativeWebSocket || (NativeWebSocket.__mwiGuildCreditBridge && !adoptLoader)) {
    diagnostics.installMode = NativeWebSocket ? "existing_wrapper" : "websocket_unavailable";
    diagnostics.observerActive = Boolean(NativeWebSocket && NativeWebSocket.__mwiGuildCreditBridge);
    publishBridgeDiagnostics();
    return;
  }
  const instrumentedSockets = new WeakSet();

  function instrumentSocket(socket) {
    if (
      !socket ||
      !isGameWebSocketUrl(socket.url) ||
      typeof socket.addEventListener !== "function" ||
      instrumentedSockets.has(socket)
    ) {
      return socket;
    }
    instrumentedSockets.add(socket);
    socket.addEventListener("message", (event) => {
      // The loader's earlier listener already puts this frame in the buffer.
      keepSocketMessage(event.data, !adoptLoader);
    });
    return socket;
  }

  function ObservedWebSocket(...args) {
    return instrumentSocket(new NativeWebSocket(...args));
  }
  ObservedWebSocket.prototype = NativeWebSocket.prototype;
  Object.setPrototypeOf(ObservedWebSocket, NativeWebSocket);
  ObservedWebSocket.__mwiGuildCreditBridge = true;
  page.WebSocket = ObservedWebSocket;
  bridge.runtimeSocketObserverActive = true;
  if (adoptLoader) {
    for (const socket of bridge.sockets) instrumentSocket(socket);
    for (const message of bridge.messages.slice()) keepSocketMessage(message, false);
  }
  bridge.marketObserverActive = true;
  diagnostics.installMode = adoptLoader
    ? "development_loader_handoff"
    : page === window
      ? "direct_main_world"
      : "unsafe_window_fallback";
  diagnostics.injectionReady = page.WebSocket === ObservedWebSocket;
  diagnostics.observerActive = true;
  publishBridgeDiagnostics();
})();


// SOURCE: src/item-name-catalog.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildCreditItemNameCatalog = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "mwi-official-item-name-catalog-v1";
  const SCHEMA_VERSION = 1;
  const ITEM_HRID = /^\/items\/[a-z0-9_]+$/i;
  const CHINESE_TEXT = /[\u3400-\u9fff]/u;
  const INITIAL_RETRY_DELAY_MS = 3000;
  const MAX_RETRY_DELAY_MS = 60000;
  const MAX_WEBPACK_FACTORIES = 6000;
  const MAX_WEBPACK_CANDIDATES = 12;

  function normalizeLocale(locale) {
    return String(locale || "")
      .toLowerCase()
      .startsWith("zh")
      ? "zh-CN"
      : "en";
  }

  function normalizeItemHrid(value) {
    const key = String(value || "").trim();
    if (ITEM_HRID.test(key)) return key;
    return /^[a-z0-9_]+$/i.test(key) ? `/items/${key}` : null;
  }

  function cleanName(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  function liveCatalogSource(source) {
    return (
      source === "window-i18n" ||
      source === "react-provider" ||
      source === "webpack-locale" ||
      source === "official-merged"
    );
  }

  function refreshRetryDelay(attemptCount) {
    const attempts = Number.isSafeInteger(attemptCount) && attemptCount > 0 ? attemptCount : 0;
    if (attempts < 5) return INITIAL_RETRY_DELAY_MS;
    return Math.min(MAX_RETRY_DELAY_MS, INITIAL_RETRY_DELAY_MS * 2 ** Math.min(attempts - 4, 5));
  }

  function catalogFromItemNames(itemNames) {
    if (!itemNames || typeof itemNames !== "object" || Array.isArray(itemNames)) return Object.create(null);
    const names = Object.create(null);
    for (const [rawKey, rawName] of Object.entries(itemNames)) {
      const itemHrid = normalizeItemHrid(rawKey);
      const name = cleanName(rawName);
      if (itemHrid && name) names[itemHrid] = name;
    }
    return names;
  }

  function itemNameMapsFromI18n(root) {
    if (!root || typeof root !== "object") return [];
    const resourceRoots = [
      root.resources,
      root.options && root.options.resources,
      root.store && root.store.data,
      root.services && root.services.resourceStore && root.services.resourceStore.data,
      root.resourceStore && root.resourceStore.data,
      root.data,
      root
    ].filter((value) => value && typeof value === "object");
    const maps = [];
    for (const resources of resourceRoots) {
      for (const localeKey of ["zh", "zh-CN", "zh_CN", "zh-Hans", "zh-Hans-CN"]) {
        const locale = resources[localeKey];
        if (!locale || typeof locale !== "object") continue;
        const translation = locale.translation && typeof locale.translation === "object" ? locale.translation : locale;
        if (translation.itemNames && typeof translation.itemNames === "object") maps.push(translation.itemNames);
        if (locale.itemNames && typeof locale.itemNames === "object") maps.push(locale.itemNames);
      }
    }
    return maps;
  }

  function i18nVariants(candidate) {
    if (!candidate || typeof candidate !== "object") return [];
    return [
      candidate,
      candidate.i18n,
      candidate.i18next,
      candidate.value,
      candidate.value && candidate.value.i18n,
      candidate.context,
      candidate.context && candidate.context.i18n,
      candidate.props && candidate.props.i18n
    ].filter((value) => value && typeof value === "object");
  }

  function extractOfficialItemNameCatalog(roots) {
    const candidates = Array.isArray(roots) ? roots : [roots];
    const names = Object.create(null);
    for (const root of candidates) {
      for (const candidate of i18nVariants(root)) {
        for (const itemNames of itemNameMapsFromI18n(candidate)) {
          Object.assign(names, catalogFromItemNames(itemNames));
        }
      }
    }
    const entryCount = Object.keys(names).length;
    return { names, entryCount, valid: entryCount > 0 };
  }

  function webpackChunkEntries(pageWindow) {
    if (!pageWindow || typeof pageWindow !== "object") return [];
    const entries = [];
    try {
      for (const key of Object.getOwnPropertyNames(pageWindow)) {
        if (!/^webpack(?:jsonp|chunk)/i.test(key)) continue;
        let queue;
        try {
          queue = pageWindow[key];
        } catch (_) {
          continue;
        }
        if (!Array.isArray(queue)) continue;
        for (const entry of queue) {
          if (entry && entry[1] && typeof entry[1] === "object") entries.push(entry);
        }
      }
    } catch (_) {
      return [];
    }
    return entries;
  }

  function webpackLocaleModuleMap(entries) {
    const moduleMap = new Map();
    const pattern = /["']\.\/([^"'\\]+)\/index\.js["']\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/g;
    let scanned = 0;
    for (const entry of entries) {
      for (const factory of Object.values(entry[1])) {
        if (typeof factory !== "function" || scanned >= MAX_WEBPACK_FACTORIES) continue;
        scanned += 1;
        let source;
        try {
          source = Function.prototype.toString.call(factory);
        } catch (_) {
          continue;
        }
        if (!source.includes("./zh-TW/index.js")) continue;
        for (const match of source.matchAll(pattern)) {
          const locale = String(match[1] || "")
            .trim()
            .toLowerCase()
            .replaceAll("_", "-");
          if (locale === "zh" || locale === "zh-cn" || locale === "zh-hans" || locale.startsWith("zh-hans-"))
            moduleMap.set("zh-CN", String(match[2]));
        }
      }
    }
    return moduleMap;
  }

  function runWebpackLocaleFactory(factory) {
    const module = { exports: {} };
    const exports = module.exports;
    const webpackRequire = () => {
      throw new Error("The game locale module unexpectedly imported another module");
    };
    webpackRequire.r = (target) => Object.defineProperty(target, "__esModule", { value: true });
    webpackRequire.d = (target, nameOrDefinition, getter) => {
      const definition = typeof nameOrDefinition === "object" ? nameOrDefinition : { [nameOrDefinition]: getter };
      for (const [name, get] of Object.entries(definition)) {
        if (typeof get !== "function" || Object.hasOwn(target, name)) continue;
        Object.defineProperty(target, name, { enumerable: true, get });
      }
    };
    factory.call(exports, module, exports, webpackRequire);
    return module.exports && module.exports.default
      ? module.exports.default
      : exports && exports.default
        ? exports.default
        : module.exports;
  }

  function validLocaleResourceMap(value, prefix) {
    return Boolean(
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).some((key) => key.startsWith(prefix))
    );
  }

  function validGameLocaleResources(resources) {
    return Boolean(
      resources &&
      typeof resources === "object" &&
      validLocaleResourceMap(resources.itemNames, "/items/") &&
      validLocaleResourceMap(resources.actionNames, "/actions/") &&
      validLocaleResourceMap(resources.monsterNames, "/monsters/") &&
      validLocaleResourceMap(resources.abilityNames, "/abilities/")
    );
  }

  function extractWebpackItemNameCatalog(pageWindow) {
    const entries = webpackChunkEntries(pageWindow);
    if (!entries.length) return { names: Object.create(null), entryCount: 0, valid: false, source: "webpack-locale" };
    const expectedModuleId = webpackLocaleModuleMap(entries).get("zh-CN");
    const preferred = [];
    const fallback = [];
    let scanned = 0;
    for (const entry of entries) {
      for (const [moduleId, factory] of Object.entries(entry[1])) {
        if (typeof factory !== "function" || scanned >= MAX_WEBPACK_FACTORIES) continue;
        scanned += 1;
        if (expectedModuleId && moduleId === expectedModuleId) {
          preferred.push(factory);
          continue;
        }
        if (expectedModuleId || fallback.length >= MAX_WEBPACK_CANDIDATES) continue;
        let source;
        try {
          source = Function.prototype.toString.call(factory);
        } catch (_) {
          continue;
        }
        if (
          source.includes("itemNames") &&
          source.includes("actionNames") &&
          source.includes("monsterNames") &&
          source.includes("abilityNames")
        )
          fallback.push(factory);
      }
    }
    for (const factory of [...preferred, ...fallback].slice(0, MAX_WEBPACK_CANDIDATES)) {
      try {
        const resources = runWebpackLocaleFactory(factory);
        if (!validGameLocaleResources(resources)) continue;
        const names = catalogFromItemNames(resources.itemNames);
        const entryCount = Object.keys(names).length;
        if (entryCount) return { names, entryCount, valid: true, source: "webpack-locale" };
      } catch (_) {
        // A changed or dependent game module is not a fatal localization failure.
      }
    }
    return { names: Object.create(null), entryCount: 0, valid: false, source: "webpack-locale" };
  }

  function extractVisibleItemNameCatalog(documentRef) {
    const names = Object.create(null);
    if (!documentRef || typeof documentRef.querySelectorAll !== "function")
      return { names, entryCount: 0, valid: false, source: "visible-dom" };
    let uses;
    try {
      uses = Array.from(documentRef.querySelectorAll('svg[role="img"][aria-label] use')).slice(0, 2000);
    } catch (_) {
      return { names, entryCount: 0, valid: false, source: "visible-dom" };
    }
    for (const use of uses) {
      const icon = use && use.closest && use.closest('svg[role="img"][aria-label]');
      if (!icon) continue;
      const pluginRoot = icon.closest && icon.closest("#mwi-credit-optimizer, #mwi-guild-exchange-advisor-host");
      if (pluginRoot) continue;
      const name = cleanName(icon.getAttribute && icon.getAttribute("aria-label"));
      if (!name || !CHINESE_TEXT.test(name)) continue;
      const href = String((use.getAttribute && (use.getAttribute("href") || use.getAttribute("xlink:href"))) || "");
      const hashIndex = href.lastIndexOf("#");
      if (hashIndex < 0) continue;
      const base = href.slice(0, hashIndex).toLowerCase();
      if (base && !base.includes("items_sprite")) continue;
      const itemHrid = normalizeItemHrid(href.slice(hashIndex + 1));
      if (itemHrid) names[itemHrid] = name;
    }
    const entryCount = Object.keys(names).length;
    return { names, entryCount, valid: entryCount > 0, source: "visible-dom" };
  }

  function reactI18nRoots(documentRef) {
    if (!documentRef) return [];
    const found = [];
    const gamePageRoots = [];
    try {
      gamePageRoots.push(
        ...Array.from(documentRef.querySelectorAll('[class^="GamePage"], [class*="GamePage"]')).slice(0, 12)
      );
    } catch (_) {
      // A restricted document should still allow the direct window candidates.
    }

    function fibersFromRoot(root) {
      if (!root) return [];
      const fibers = [];
      for (const key of Reflect.ownKeys(root)) {
        const keyName = String(key);
        if (
          keyName.startsWith("__reactFiber$") ||
          keyName.startsWith("__reactContainer$") ||
          keyName.startsWith("__reactInternalInstance$")
        )
          fibers.push(root[key]);
      }
      return fibers;
    }

    function addFiberCandidates(fiber) {
      const candidates = [
        fiber && fiber.memoizedProps,
        fiber && fiber.pendingProps,
        fiber && fiber.memoizedState,
        fiber && fiber.stateNode && fiber.stateNode.state,
        fiber && fiber.stateNode && fiber.stateNode.props,
        fiber && fiber.stateNode
      ];
      for (const candidate of candidates) found.push(...i18nVariants(candidate));
    }

    // The game page is below the i18n provider. Walking its parent chain is
    // dramatically cheaper than repeatedly traversing the entire React tree.
    for (const root of gamePageRoots) {
      for (const initialFiber of fibersFromRoot(root)) {
        let fiber = initialFiber;
        for (let depth = 0; fiber && depth < 24; depth += 1, fiber = fiber.return) addFiberCandidates(fiber);
      }
    }
    if (found.length) return found;

    const roots = [documentRef.getElementById && documentRef.getElementById("root"), documentRef.body].filter(Boolean);
    const fibers = [];
    for (const root of roots) fibers.push(...fibersFromRoot(root));
    const visited = new Set();
    let scanned = 0;
    while (fibers.length && scanned < 1500) {
      const fiber = fibers.pop();
      if (!fiber || typeof fiber !== "object" || visited.has(fiber)) continue;
      visited.add(fiber);
      scanned += 1;
      addFiberCandidates(fiber);
      if (fiber.current) fibers.push(fiber.current);
      if (fiber.stateNode && fiber.stateNode.current) fibers.push(fiber.stateNode.current);
      if (fiber.child) fibers.push(fiber.child);
      if (fiber.sibling) fibers.push(fiber.sibling);
      if (fiber.return) fibers.push(fiber.return);
    }
    return found.filter((value) => value && typeof value === "object");
  }

  function readCachedCatalog(storage) {
    try {
      const stored = JSON.parse((storage && storage.getItem(STORAGE_KEY)) || "");
      if (!stored || stored.schemaVersion !== SCHEMA_VERSION || !stored.names || typeof stored.names !== "object")
        return null;
      const names = catalogFromItemNames(stored.names);
      const entryCount = Object.keys(names).length;
      return entryCount
        ? {
            names,
            entryCount,
            source: "cache",
            sources: Array.isArray(stored.sources) ? stored.sources.filter((source) => typeof source === "string") : [],
            updatedAt: stored.updatedAt || null,
            version: stored.version || null
          }
        : null;
    } catch (_) {
      return null;
    }
  }

  function persistCatalog(storage, catalog) {
    try {
      storage &&
        storage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            schemaVersion: SCHEMA_VERSION,
            source: catalog.source,
            sources: catalog.sources,
            updatedAt: catalog.updatedAt,
            entryCount: catalog.entryCount,
            version: catalog.version,
            names: catalog.names
          })
        );
    } catch (_) {
      // A read-only storage environment should not prevent live name resolution.
    }
  }

  function pageI18nRoots(pageWindow) {
    if (!pageWindow || typeof pageWindow !== "object") return [];
    return [pageWindow.i18next, pageWindow.i18n, pageWindow.mwi && pageWindow.mwi.lang].filter(
      (value) => value && typeof value === "object"
    );
  }

  function createItemNameCatalog(options) {
    const pageWindow = options && options.pageWindow;
    const documentRef = options && options.document;
    const storage = options && options.storage;
    const version = (options && options.version) || null;
    let current = readCachedCatalog(storage) || {
      names: Object.create(null),
      entryCount: 0,
      source: "unavailable",
      sources: [],
      updatedAt: null,
      version
    };
    let lastRefreshAt = null;
    let refreshAttempts = 0;
    let lastRefreshChanged = false;

    function sameNames(left, right) {
      const leftEntries = Object.entries(left || {});
      const rightEntries = Object.entries(right || {});
      return (
        leftEntries.length === rightEntries.length &&
        leftEntries.every(([itemHrid, name]) => right && right[itemHrid] === name)
      );
    }

    function refresh() {
      lastRefreshChanged = false;
      const catalogs = [
        extractVisibleItemNameCatalog(documentRef),
        { ...extractOfficialItemNameCatalog(reactI18nRoots(documentRef)), source: "react-provider" },
        extractWebpackItemNameCatalog(pageWindow),
        { ...extractOfficialItemNameCatalog(pageI18nRoots(pageWindow)), source: "window-i18n" }
      ].filter((catalog) => catalog.valid);
      if (!catalogs.length) return current;
      const names = Object.assign(Object.create(null), current.names);
      for (const catalog of catalogs) Object.assign(names, catalog.names);
      const sources = Array.from(new Set(catalogs.map((catalog) => catalog.source)));
      const officialSources = sources.filter((source) => source !== "visible-dom");
      const source = officialSources.length > 1 ? "official-merged" : officialSources[0] || sources[0] || "unavailable";
      lastRefreshChanged = !sameNames(current.names, names);
      const metadataChanged = current.source !== source || current.sources.join("\n") !== sources.join("\n");
      if (!lastRefreshChanged && !metadataChanged) return current;
      current = {
        names,
        entryCount: Object.keys(names).length,
        source,
        sources,
        updatedAt: new Date().toISOString(),
        version
      };
      persistCatalog(storage, current);
      return current;
    }

    function refreshIfDue(options = {}) {
      const force = options.force === true;
      const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
      const requiredItemHrids = Array.from(
        new Set((options.requiredItemHrids || []).map(normalizeItemHrid).filter(Boolean))
      );
      const ready =
        liveCatalogSource(current.source) && requiredItemHrids.every((itemHrid) => Boolean(current.names[itemHrid]));
      const delay = refreshRetryDelay(refreshAttempts);
      if (!force && (ready || (lastRefreshAt !== null && now - lastRefreshAt < delay))) {
        return { attempted: false, changed: false, ready, retryCount: refreshAttempts, nextDelayMs: delay };
      }
      lastRefreshAt = now;
      refreshAttempts += 1;
      const refreshed = refresh();
      const refreshedReady =
        liveCatalogSource(refreshed.source) &&
        requiredItemHrids.every((itemHrid) => Boolean(refreshed.names[itemHrid]));
      return {
        attempted: true,
        changed: lastRefreshChanged,
        ready: refreshedReady,
        retryCount: refreshAttempts,
        nextDelayMs: refreshRetryDelay(refreshAttempts)
      };
    }

    function resolveItemName({ itemHrid, englishFallback, locale }) {
      const normalized = normalizeItemHrid(itemHrid);
      const englishName = cleanName(englishFallback) || normalized || String(itemHrid || "");
      if (normalizeLocale(locale) !== "zh-CN" || !normalized) return englishName;
      return current.names[normalized] || englishName;
    }

    function coverage(itemHrids) {
      const requested = Array.from(
        new Set((Array.isArray(itemHrids) ? itemHrids : []).map(normalizeItemHrid).filter(Boolean))
      );
      const missing = requested.filter((itemHrid) => !current.names[itemHrid]);
      return {
        requestedCount: requested.length,
        officialHitCount: requested.length - missing.length,
        missingItemHrids: missing,
        source: current.source,
        catalogEntryCount: current.entryCount
      };
    }

    return { refresh, refreshIfDue, resolveItemName, coverage, metadata: () => ({ ...current, names: undefined }) };
  }

  return {
    STORAGE_KEY,
    normalizeLocale,
    normalizeItemHrid,
    liveCatalogSource,
    refreshRetryDelay,
    catalogFromItemNames,
    extractOfficialItemNameCatalog,
    extractWebpackItemNameCatalog,
    extractVisibleItemNameCatalog,
    createItemNameCatalog
  };
});


// SOURCE: src/release-info.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildCreditReleaseInfo = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
  const DEFAULT_TIMEOUT_MS = 8000;

  function parseUserScriptVersion(source) {
    const match = String(source || "").match(/^\/\/ @version\s+(.+)$/m);
    return (match && match[1].trim()) || null;
  }

  function createVersionChecker(options) {
    const fetchImpl = options && options.fetchImpl;
    const configuredSources = options && Array.isArray(options.sources) ? options.sources : [];
    const sources = configuredSources.length
      ? configuredSources.filter((source) => source && source.url)
      : options && options.url
        ? [{ url: options.url, installUrl: options.url }]
        : [];
    const cacheTtlMs = Number(options && options.cacheTtlMs) || DEFAULT_CACHE_TTL_MS;
    const timeoutMs = Number(options && options.timeoutMs) || DEFAULT_TIMEOUT_MS;
    const setTimer = (options && options.setTimeout) || setTimeout;
    const clearTimer = (options && options.clearTimeout) || clearTimeout;
    const Controller =
      (options && options.AbortController) || (typeof AbortController === "function" ? AbortController : null);
    let cached = null;
    let request = null;

    async function requestSource(source) {
      const controller = Controller ? new Controller() : null;
      let timeout = null;
      try {
        const timeoutPromise = new Promise((_, reject) => {
          timeout = setTimer(() => {
            if (controller) controller.abort();
            reject(new Error("更新檢查超時"));
          }, timeoutMs);
        });
        const release = await Promise.race([
          (async () => {
            const response = await fetchImpl(source.url, {
              cache: "no-store",
              signal: controller && controller.signal
            });
            if (!response || !response.ok)
              throw new Error(`更新資訊請求失敗 (${(response && response.status) || "未知"})`);
            const latestVersion = parseUserScriptVersion(await response.text());
            if (!latestVersion) throw new Error("未找到最新版本號");
            return { latestVersion, installUrl: source.installUrl || source.url };
          })(),
          timeoutPromise
        ]);
        return release;
      } finally {
        if (timeout !== null) clearTimer(timeout);
      }
    }

    async function requestLatestRelease() {
      if (typeof fetchImpl !== "function" || sources.length === 0) throw new Error("更新檢查不可用");
      let lastError = null;
      for (const source of sources) {
        try {
          const release = await requestSource(source);
          cached = { release, checkedAt: Date.now() };
          return release;
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error("更新檢查不可用");
    }

    function latestRelease() {
      if (cached && Date.now() - cached.checkedAt < cacheTtlMs) return Promise.resolve(cached.release);
      if (!request)
        request = requestLatestRelease().finally(() => {
          request = null;
        });
      return request;
    }

    function latestVersion() {
      return latestRelease().then((release) => release.latestVersion);
    }

    return { latestRelease, latestVersion };
  }

  return { DEFAULT_CACHE_TTL_MS, DEFAULT_TIMEOUT_MS, parseUserScriptVersion, createVersionChecker };
});


// SOURCE: src/guild-building-data.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildBuildingData = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const RULES_VERSION = "2026-08-04-v1";
  const MAX_LEVEL = 20;
  const BASE_LEVEL_COSTS = Object.freeze([
    null,
    1000,
    1350,
    1800,
    2450,
    3300,
    4500,
    6050,
    8150,
    11050,
    14900,
    20100,
    27150,
    36650,
    49450,
    66800,
    90150,
    121700,
    164300,
    221800,
    299450
  ]);

  const BUILDINGS = Object.freeze([
    { hrid: "/guild_buildings/guild_hall", nameKey: "buildingGuildHall", category: "core", costMultiplier: 1 },
    { hrid: "/guild_buildings/builders_hall", nameKey: "buildingBuildersHall", category: "core", costMultiplier: 1 },
    { hrid: "/guild_buildings/archives", nameKey: "buildingArchives", category: "core", costMultiplier: 1 },
    { hrid: "/guild_buildings/treasury", nameKey: "buildingTreasury", category: "core", costMultiplier: 1 },
    {
      hrid: "/guild_buildings/skilling_encampment",
      nameKey: "buildingSkillingEncampment",
      category: "life",
      costMultiplier: 0.5
    },
    { hrid: "/guild_buildings/workshop", nameKey: "buildingWorkshop", category: "life", costMultiplier: 0.5 },
    { hrid: "/guild_buildings/forge", nameKey: "buildingForge", category: "life", costMultiplier: 0.5 },
    { hrid: "/guild_buildings/log_shed", nameKey: "buildingLogShed", category: "life", costMultiplier: 0.5 },
    { hrid: "/guild_buildings/garden", nameKey: "buildingGarden", category: "life", costMultiplier: 0.5 },
    { hrid: "/guild_buildings/dairy_barn", nameKey: "buildingDairyBarn", category: "life", costMultiplier: 0.5 },
    { hrid: "/guild_buildings/kitchen", nameKey: "buildingKitchen", category: "life", costMultiplier: 0.5 },
    { hrid: "/guild_buildings/sewing_parlor", nameKey: "buildingSewingParlor", category: "life", costMultiplier: 0.5 },
    { hrid: "/guild_buildings/brewery", nameKey: "buildingBrewery", category: "life", costMultiplier: 0.5 },
    { hrid: "/guild_buildings/library", nameKey: "buildingLibrary", category: "life", costMultiplier: 0.5 },
    { hrid: "/guild_buildings/laboratory", nameKey: "buildingLaboratory", category: "life", costMultiplier: 0.5 },
    {
      hrid: "/guild_buildings/mystical_study",
      nameKey: "buildingMysticalStudy",
      category: "life",
      costMultiplier: 0.5
    },
    {
      hrid: "/guild_buildings/combat_encampment",
      nameKey: "buildingCombatEncampment",
      category: "combat",
      costMultiplier: 0.5
    },
    { hrid: "/guild_buildings/gym", nameKey: "buildingGym", category: "combat", costMultiplier: 0.5 },
    { hrid: "/guild_buildings/dojo", nameKey: "buildingDojo", category: "combat", costMultiplier: 0.5 },
    {
      hrid: "/guild_buildings/archery_range",
      nameKey: "buildingArcheryRange",
      category: "combat",
      costMultiplier: 0.5
    },
    { hrid: "/guild_buildings/armory", nameKey: "buildingArmory", category: "combat", costMultiplier: 0.5 },
    { hrid: "/guild_buildings/dining_room", nameKey: "buildingDiningRoom", category: "combat", costMultiplier: 0.5 },
    { hrid: "/guild_buildings/observatory", nameKey: "buildingObservatory", category: "life", costMultiplier: 0.5 },
    { hrid: "/guild_shrines/tempo", nameKey: "shrineTempo", category: "shrine", costMultiplier: 1 },
    { hrid: "/guild_shrines/spirit", nameKey: "shrineSpirit", category: "shrine", costMultiplier: 1 },
    { hrid: "/guild_shrines/force", nameKey: "shrineForce", category: "shrine", costMultiplier: 1 },
    { hrid: "/guild_shrines/rarity", nameKey: "shrineRarity", category: "shrine", costMultiplier: 1 },
    { hrid: "/guild_shrines/scholar", nameKey: "shrineScholar", category: "shrine", costMultiplier: 1 }
  ]);

  // Official client getSortedBuildingDetails uses sortIndex. This fallback matches
  // the native catalog when initialization details have not arrived yet (2026-09-25).
  const CATALOG_BUILDING_ORDER = Object.freeze(
    [
      "guild_hall",
      "builders_hall",
      "treasury",
      "archives",
      "skilling_encampment",
      "combat_encampment",
      "dairy_barn",
      "garden",
      "log_shed",
      "forge",
      "workshop",
      "sewing_parlor",
      "kitchen",
      "brewery",
      "laboratory",
      "observatory",
      "dining_room",
      "library",
      "dojo",
      "armory",
      "gym",
      "archery_range",
      "mystical_study"
    ].map((name) => `/guild_buildings/${name}`)
  );

  function sortCatalogDefinitions(definitions, buildingDetails, shrineDetails) {
    const fallback = new Map(
      [
        ...CATALOG_BUILDING_ORDER,
        ...BUILDINGS.filter((entry) => entry.category === "shrine").map((entry) => entry.hrid)
      ].map((hrid, index) => [hrid, index])
    );
    function orderedGroup(entries, details) {
      const indices = new Map(
        Object.entries(details || {}).flatMap(([key, detail]) => {
          if (!detail || !Number.isFinite(detail.sortIndex)) return [];
          return [[detail.hrid || detail.guildBuildingHrid || detail.guildShrineHrid || key, detail.sortIndex]];
        })
      );
      // Do not mix official indices with fallback positions on different numeric scales.
      const complete = entries.every((entry) => indices.has(entry.hrid));
      return entries
        .slice()
        .sort(
          (a, b) =>
            (complete ? indices.get(a.hrid) - indices.get(b.hrid) : 0) ||
            (fallback.get(a.hrid) ?? fallback.size) - (fallback.get(b.hrid) ?? fallback.size)
        );
    }
    return [
      ...orderedGroup(
        definitions.filter((entry) => entry.category !== "shrine"),
        buildingDetails
      ),
      ...orderedGroup(
        definitions.filter((entry) => entry.category === "shrine"),
        shrineDetails
      )
    ];
  }

  function iconSymbolId(buildingHrid) {
    const building = BUILDINGS.find((entry) => entry.hrid === buildingHrid);
    if (!building) return "";
    const [group, name] = building.hrid.split("/").filter(Boolean);
    if (group === "guild_buildings") return `guild_${name}`;
    if (group === "guild_shrines") return `guild_shrine_${name}`;
    return "";
  }

  function levelCostsForMultiplier(multiplier) {
    const factor = Number(multiplier);
    return BASE_LEVEL_COSTS.map((cost) => (cost === null ? null : { guildPointCost: Math.round(cost * factor) }));
  }

  function definitions() {
    return BUILDINGS.map((building) => ({
      ...building,
      iconSymbolId: iconSymbolId(building.hrid),
      maxLevel: MAX_LEVEL,
      levelCosts: levelCostsForMultiplier(building.costMultiplier),
      rulesVersion: RULES_VERSION
    }));
  }

  return {
    RULES_VERSION,
    MAX_LEVEL,
    BASE_LEVEL_COSTS,
    BUILDINGS,
    CATALOG_BUILDING_ORDER,
    sortCatalogDefinitions,
    iconSymbolId,
    levelCostsForMultiplier,
    definitions
  };
});


// SOURCE: src/localization.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildCreditLocalization = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STRINGS = {
    "zh-CN": {
      settingsHelp: "幫助",
      helpRankingOrder: "榜單順序",
      helpSettingsAndMarket: "設定與市場參考",
      helpForecastEvidence:
        "預測僅使用回看範圍內的已確認記錄和非零遊戲追蹤值。自動估算不參與，追蹤零值需手動確認後參與。",
      helpForecastBacktest: "歷史回測用於檢視線性迴歸在已有記錄上的表現，不改變當前預測方法。",
      helpConstructionEta: "按計劃缺少的點數估算等待時間：先計本週預計剩餘，再按下週預測點數估算後續各周。",
      helpTrialCoverage: "部分成員數值未知時，彙總僅包含該指標的已知值。",
      helpCreditExchangeMode: "信用點卡片顯示當前兌換方式，點選可在最優物品和公會代幣之間切換。",
      unknownItem: "未知物品",
      priceReferenceA: "左一",
      priceReferenceATitle: "左一：最低出售價，可立即買入",
      priceReferenceB: "右一",
      priceReferenceBTitle: "右一：最高收購價；低於可交易區間的報價會忽略",
      marketItem: "在市場中檢視{item}",
      updateChecking: "當前版本 v{current} · 最新版本：檢查中...",
      updateAvailable: "當前版本 v{current} · 最新版本 v{latest} · 發現新版本",
      updateNow: "立即更新",
      updateLatest: "當前版本 v{current} · 最新版本 v{latest} · 已是最新",
      updateUnavailable: "當前版本 v{current} · 最新版本：暫時無法讀取",
      shrineCollapse: "收起",
      shrineExpand: "展開",
      shrineCollapseNamed: "收起{shrine}升級計劃",
      shrineExpandNamed: "展開{shrine}升級計劃",
      shrineNoMaterials: "無需材料",
      shrineAlreadyPlanned: "已在其他計劃中",
      shrineMaxed: "已達最高等級",
      shrineGain: "增量 {value}",
      shrineRemoveNamed: "移除{shrine}計劃",
      shrineLevelStatus: "個人已購 {current} 級 · 公會上限 {cap} 級",
      shrineNextLevel: "升一級",
      shrineToGuildCap: "到公會上限",
      shrineStartAssumed: "個人等級尚未讀取。起始等級僅用於估算，請按實際等級調整。",
      shrineCapUnknown: "公會神龕等級尚未讀取，暫無法確認目標是否可用。",
      shrineAboveCap: "目標超過當前公會 {level} 級上限，僅用於未來規劃；超出部分暫不生效。",
      shrineEffectComparison: "效果變化",
      shrineLevelRange: "{start} 級 → {target} 級",
      shrineRangeCost: "本計劃所需材料",
      shrineSteps: "逐級效果與花費 · {count} 級",
      shrineStepsHint: "列出所選區間的每次升級：顯示升至該級後的總效果，以及僅該次升級所需的材料。",
      shrineStepLevel: "{start} → {target} 級",
      shrineEffectsPerLevel: "每級：{effects}",
      shrineEffectsFirstAndPerLevel: "首級：{first}；後續每級：{later}",
      shrineEffectPerLevel: "每級：{effect} {value}",
      shrineEffectFirstAndPerLevel: "{effect}：首級 {first}；後續每級 {value}",
      shrineEffectsUnavailable: "每級效果暫未讀取",
      shrineEffectActionSpeed: "行動速度",
      shrineEffectAttackSpeed: "攻擊速度",
      shrineEffectCastSpeed: "施法速度",
      shrineEffectEfficiency: "效率",
      shrineEffectDamage: "傷害",
      shrineEffectEssenceFind: "精華髮現",
      shrineEffectMaxHp: "最大HP",
      shrineEffectMaxMp: "最大MP",
      shrineEffectRareFind: "稀有發現",
      shrineEffectExperience: "經驗",
      shrineForce: "力量神龕",
      shrineTempo: "節奏神龕",
      shrineSpirit: "精神神龕",
      shrineRarity: "稀有神龕",
      shrineScholar: "學者神龕",
      domainLife: "生活",
      domainCombat: "戰鬥",
      shrineWithDomain: "{shrine}（{domain}）",
      guildTargetApplied: "已按當前公會神龕等級設定{domain}計劃，共 {count} 項需要升級。",
      guildTargetComplete: "當前已達到最大等級（{domain}）。",
      plansCleared: "已清空全部神龕升級計劃。",
      level: "{level} 級",
      targetButtonReady: "按每座對應公會神龕的當前等級批次設定目標",
      targetButtonMissing: "尚未讀取完整的公會神龕建築等級：{missing}",
      targetSummary: "{domain} {count}/{total}{missing}",
      targetSummaryMissing: "（未識別：{missing}）",
      shrineLevelsRead: "公會神龕等級已讀取：{summaries}。",
      shrineLevelsReading: "正在讀取當前公會神龕建築等級…",
      shrine: "神龕",
      startLevel: "起始等級",
      targetLevel: "目標等級",
      removePlan: "移除此項",
      gold: "金幣",
      guildTokens: "公會代幣",
      noSnapshotEstimate: "未讀取到公開市場快照，暫無法估算金幣成本。",
      partialEstimatedCost: "預計成本（已定價部分）",
      estimatedTotalCost: "預計總成本",
      partialAfterInventory: "庫存後缺口（已定價部分）",
      afterInventory: "庫存後仍需",
      inventoryUnavailable: "未讀取背包庫存，缺口暫按 0 件庫存計算。",
      noCreditPrice: "以下信用點暫無可用市場價格：{items}。",
      costSummary: "成本概覽",
      inventoryAndMissing: "庫存 {owned} · 缺 {missing}",
      inventory: "庫存 {count}",
      missingCount: "缺 {count}",
      inventoryNotRead: "庫存未讀取",
      inventoryCoveredNoExchange: "現有庫存已覆蓋，無需兌換",
      backpackInventory: "背包庫存 {count}",
      notRead: "未讀取",
      useGuildTokensForMissingCredits: "全部信用點使用公會代幣",
      useGuildTokensForMissingCreditsHint: "快速選擇或清除全部；也可在每張信用點卡片單獨切換。",
      guildTokenCreditPlanActive: "缺少的信用點已全部按公會代幣兌換計算。",
      guildTokenCreditPlanPartialActive: "已選擇 {count} 種信用點按公會代幣兌換計算。",
      guildTokenCreditPlanSummary: "其中 {count} 公會代幣用於兌換信用點。",
      autoGuildTokenBudget: "自動兌換代幣預算",
      autoGuildTokenBudgetHint: "按每枚公會代幣的市場兌換價值從高到低分配。",
      autoGuildTokenBudgetAvailable: "本次最多可用 {count}",
      autoGuildTokenPlanSummary: "已按兌換價值自動分配 {count} 枚庫存公會代幣。",
      autoGuildTokenExchangeNeeds: "自動分配代幣",
      autoGuildTokenCoverage: "覆蓋 {count} 信用點",
      optimalItemCreditMode: "最優物品",
      guildTokenCreditMode: "公會代幣",
      creditExchangeModeTitle: "當前使用{mode}兌換；點選切換。",
      guildTokenExchangeNeeds: "代幣兌換需",
      optimalExchangeNeeds: "最優兌換需",
      exchangeRate: "{items} → {credits}",
      itemQuantity: "{count} 個",
      creditQuantity: "{count} 點",
      optimalExchangeUnavailable: "最優兌換：暫無可用市場價格",
      requiredThisTime: "本次所需",
      noGuildRules: "未讀取到神龕升級規則。請重新整理遊戲頁面後重新開啟公會。",
      noUpgradePlans: "當前沒有神龕升級計劃。",
      noUpgradePlansHint: "點選“新增神龕”，或使用上方按鈕按當前公會等級填充。",
      allBuffsMaxed: "當前所有神龕增益均已滿級。",
      noUpgradeMaterials: "當前沒有需要計算的神龕升級材料。",
      missingLevelCost: "缺少 {level} 級升級成本資料。",
      invalidLevels: "起始等級或目標等級無效。",
      mergedUpgradePlans: "已合併 {count} 項神龕升級的材料成本。",
      unknownCurrentLevels: "未讀取當前神龕等級，已按 0 級開始；請確認或手動調整“起始等級”。",
      snapshotFailed: "公開市場快照讀取失敗，暫未估算金幣成本。",
      panelTitle: "公會助手",
      creditValue: "信用點價效比",
      creditValueHint: "按目標數量比較公開市場成本，首項為當前最優兌換。",
      shrineUpgrade: "神龕升級",
      guildConstruction: "公會建設",
      panelViewOrder: "頁籤順序",
      interfaceSettings: "設定",
      interfaceSettingsHint: "調整一鍵填充範圍和外掛頁面；修改會立即在本機生效。",
      openInterfaceSettings: "開啟設定",
      closeInterfaceSettings: "返回上一頁",
      backFromSettings: "返回",
      shrineAutofillRange: "一鍵填充範圍",
      shrineAutofillRangeHint: "取消勾選後，一鍵填充不會新增或更新該神龕；已有計劃不會刪除。",
      settingsShrinesLoading: "正在讀取可配置的公會神龕…",
      settingsShrinesEmpty: "已讀取遊戲資料，但沒有可配置的公會神龕。",
      interfaceVisibility: "介面",
      sidebarDisplayName: "側欄顯示名稱",
      sidebarDisplayNameHint: "最多 24 個字元；留空恢復預設名稱。儲存後立即生效。",
      sidebarNameSave: "儲存名稱",
      sidebarNameReset: "恢復預設",
      showConstructionView: "顯示公會建設頁籤",
      showTrialHistoryView: "顯示歷史試煉資料頁籤",
      showTrialHistoryViewHint: "預設開啟。隱藏頁籤後，歷史記錄和自動儲存不受影響，可隨時重新開啟。",
      trialHistoryViewShown: "已顯示歷史試煉資料頁籤。",
      trialHistoryViewHidden: "已隱藏曆史試煉資料頁籤；歷史記錄和自動儲存不受影響。",
      showConstructionViewHint: "預設開啟。關閉後隱藏頁籤；施工計劃仍會保留，可隨時重新開啟。",
      settingsSaved: "設定已儲存。",
      settingsSaveFailed: "設定已生效，但未能儲存；重新整理頁面後可能恢復。",
      constructionViewShown: "已顯示公會建設頁面。",
      constructionViewHidden: "已隱藏公會建設頁面；施工計劃仍已保留。",
      constructionReadOnly: "管理員規劃工具 · 只計算，不會執行建築升級",
      guildPointBudget: "可用公會點數",
      manualBudget: "手工預算",
      budgetOptional: "留空使用遊戲當前可用點數",
      invalidGuildPointBudget: "請輸入不小於 0 的整數。",
      guildPointTrend: "每週公會點數",
      guildPointOverview: "公會點數與預算",
      guildPointStatisticsHeading: "點數統計與歷史",
      buildingCatalogCurrentLevel: "當前 {current} 級",
      buildingCatalogUnknownPlannedLevel: "{current} → {target} 級 · 已加入",
      buildingCatalogPlannedLevel: "{current} → {target} 級 · 已加入",
      buildingCatalogUnknownLevel: "當前 {current} 級",
      buildingCatalogNextLevelCost: "升至 {level} 級：{points} 點",
      buildingCatalogNextLevelCostUnavailable: "下一級點數未提供",
      guildPointPlanningHeading: "建設預算",
      guildPointStartingBalance: "自定起始點數",
      guildPointFollowBalance: "跟隨遊戲餘額",
      guildPointStartingBalanceHint: "選填；清空後使用當前可用點數。",
      guildPointStartingBalanceCompactHint: "留空跟隨遊戲點數",
      guildPointPlanningWeeksCompactHint: "0 = 當前；1 = 含本週剩餘",
      guildPointTrendHint: "點數儲存在本機；使用最近有效周做線性迴歸",
      guildPointAutoSaved: "自動儲存",
      guildPointSavedSnapshot: "已儲存快照",
      currentAvailableGuildPoints: "當前可用",
      currentWeekGuildPoints: "本週已獲",
      predictedCurrentWeekGuildPoints: "本週預計總量",
      latestWeeklyGuildPoints: "最近完整週獲得",
      weeklyGuildPointGrowth: "環比增長",
      guildPointEstimatedGrowth: "預計周增長速度",
      nextWeekGuildPointForecast: "下週預測",
      guildPointHistoryUnavailable: "尚未讀取公會點數；開啟公會頁面後會自動建立本機基線。",
      guildPointHistoryBaseline: "已建立累計點數基線；下一次周獎勵到賬後將生成首條週記錄。",
      guildPointForecastNeedsHistory: "回看範圍內需要至少 2 周有效點數才能做線性迴歸；不使用歷史均值補足。",
      guildPointForecastColdStart: "此前 {count} 周平均 {average} 點，本週已獲 {current} 點；均值僅供參考。",
      guildPointForecastMethod: "使用最近 {count} 周內的已核實記錄預測。",
      guildPointForecastEstimatedMethod: "依據累計點數提供歷史均值參考，自動補充記錄不參與趨勢擬合。",
      guildPointHistoryConflict: "歷史周點數合計超過遊戲累計值，已停止預測。請檢查手動記錄或重置週記錄。",
      remainingCurrentWeekGuildPoints: "本週預計剩餘",
      guildPointSourcePartial: "遊戲追蹤",
      guildPointCsvPartial: "遊戲追蹤",
      guildPointMethodMean: "近期均值",
      guildPointMethodLinear: "線性迴歸",
      guildPointMethodHistorical: "歷史均值參考",
      guildPointForecastEvidence:
        "回看 {count} 周：已確認 {reliable} 周、遊戲追蹤 {partial} 周；自動估算 {estimated} 周不參與。當前採用{method}，追蹤零值需手動確認後參與。",
      guildPointForecastDetails: "預測依據與限制",
      guildPointHelpHistorical: "已核實歷史周不足，當前使用歷史均值作參考。",
      guildPointHelpInsufficient: "當前採用近期均值；有效回測 {count}/3，暫不使用趨勢法。",
      guildPointHelpEvaluated: "當前採用{method}，已對 {count} 個歷史周進行回測。",
      guildPointHelpDataTitle: "使用哪些記錄",
      guildPointHelpData:
        "本週獲得點數大於 0 即視為已結束，回看範圍包含本週；否則從上一週向前計算。使用範圍內的已確認記錄和非零遊戲追蹤值。自動估算、缺失值不參與，追蹤零值需手動確認後參與。",
      guildPointHelpMethodTitle: "如何計算預測",
      guildPointHelpMethod:
        "以實際周次為橫軸、獲得點數為縱軸做最小二乘線性迴歸，外推目標周，四捨五入且不低於 0。至少需要 2 周有效樣本，不再根據回測切換為均值。\n缺失周保留時間間隔，不補零，也不從視窗之外補樣本。樣本不足時顯示 —。",
      guildPointHelpResultTitle: "如何理解預測結果",
      guildPointHelpResult:
        "本週已獲得點數時，預計總量等於已獲點數，預計剩餘為 0。已獲得的點數不會再次加入規劃預算。\n回測只檢驗現存歷史記錄上的表現；成員和參試情況變化後，未來結果可能不同。",
      trialHelpScreenshotPreview: "檢視截圖範圍、分享前檢查和儲存方式。",
      trialHelpScreenshotScope: "截圖包含什麼",
      trialHelpSharing: "分享與儲存",
      trialHelpHistoryPreview: "瞭解資料如何收集、儲存在何處以及如何匯入。",
      trialHelpCollection: "收集與儲存",
      trialHelpImport: "匯入歷史記錄",
      trialHelpPurpose: "如何使用這些資料",
      trialHelpFeedback: "反饋與交流",
      trialHelpColumnsPreview: "佔比與人均的分母不同，未知值也不等於零。",
      trialHelpShare: "總量佔比",
      trialHelpShareBody: "個人數值 ÷ 已知成員總量。",
      trialHelpAverage: "相對人均",
      trialHelpAverageBody:
        "個人數值 ÷ 該項非零成員平均值；1× 表示平均水平。工作量、傷害、治療和減傷前承傷分別計算，均排除該項為 0 的成員。",
      trialHelpMissing: "零值、缺失值與彙總",
      trialHelpMissingBody:
        "缺失值或無人有非零數值時顯示 —。彙總平均值排除零值；總量和中位數保留已知零值。\n顯示開關隻影響頁面，不改變歷史記錄或匯出資料。",
      trialHelpOverviewPreview: "參試次數與人均倍數僅使用已採集的遊戲記錄。",
      trialHelpOverviewScope: "統計範圍與計算方式",
      trialHelpRankingPreview: "參試次數、人均倍數和入會時間各有獨立統計口徑。",
      trialHelpCounts: "參試次數如何計算",
      trialHelpRankingAverage: "人均倍數與樣本數",
      guildPointForecastWeeks: "預測回看週數",
      guildPointForecastWeeksHint: "本週已獲點數時包含本週，否則截至上週；自動估算不參與線性迴歸。",
      increaseGuildPointForecastWeeks: "增加 1 周預測回看範圍",
      decreaseGuildPointForecastWeeks: "減少 1 周預測回看範圍",
      guildPointPlanningWeeks: "規劃週數",
      guildPointPlanningOptions: "預測設定",
      guildPointPlanningWeeksHint:
        "0 僅使用當前餘額；1 加上本週預計剩餘。之後每週按下週預測固定估算，已獲點數不重複計入。",
      increaseGuildPointPlanningWeeks: "增加 1 周規劃時間",
      decreaseGuildPointPlanningWeeks: "減少 1 周規劃時間",
      guildPointPlanningCurrentOnly: "僅當前點數",
      guildPointWeekCount: "{count} 周",
      guildPointWeekWithDate: "第 {count} 周（{date}）",
      guildPointPlanningNeedsBalance: "尚未讀取當前可用點數。",
      guildPointPlanningNeedsForecast: "已保留當前餘額；本週進度未知、樣本不足或歷史衝突，暫不加入預計收益。",
      guildPointPlanningBudgetCurrent: "規劃預算：當前 {total} 點。",
      guildPointPlanningBudgetProjected:
        "規劃預算：{current} + 本週剩餘 {remaining} + 後續 {weeks} 周 × {weekly} = {total} 點。",
      recentGuildPointHistory: "最近週記錄",
      manualGuildPointWeek: "周次",
      manualGuildPointEarned: "該周獲得點數",
      manualGuildPointEarnedForWeek: "{week} 獲得的公會點數",
      guildPointHistorySource: "來源",
      saveManualGuildPointHistory: "儲存整張表",
      manualGuildPointHint:
        "灰色佔位數為自動估算。修改遊戲追蹤值需先確認警告。清空後儲存：原追蹤值為 0 時改為自動補充，非零時恢復原值；直接填寫 0 則保留零值。當前周僅供檢視。",
      manualGuildPointHistoryEmpty: "尚無已結束的試煉周可填寫。",
      guildPointManualWeekOption: "{week} 開始",
      guildPointSourceTracked: "遊戲追蹤",
      guildPointSourceTrackedEditing: "待儲存更正",
      guildPointSourceManual: "手動錄入",
      guildPointSourceManualOverride: "手工覆蓋追蹤值",
      guildPointSourceEstimated: "自動補充",
      guildPointSourceEmpty: "待填寫",
      guildPointSourceCurrent: "遊戲追蹤中",
      guildPointSourceCurrentEstimated: "本週預測",
      guildPointSourceCurrentPending: "本週未開始",
      guildPointSourceCurrentUnavailable: "尚未讀取",
      guildPointSourceNextForecast: "下週預測",
      currentGuildPointWeek: "當前周",
      removeManualGuildPointWeek: "刪除 {week} 的手動記錄",
      manualGuildPointWeekSaved: "歷史公會點數已儲存，缺失周已重新自動補充。",
      manualGuildPointWeekTracked: "該周已有遊戲真實追蹤記錄，不能被手動值覆蓋。",
      editTrackedGuildPointWeek: "修改 {week} 的遊戲追蹤值",
      editTrackedGuildPointWeekShort: "修改",
      trackedGuildPointEditWarningTitle: "要覆蓋遊戲追蹤值嗎？",
      trackedGuildPointEditWarningBody:
        "{week} 的 {points} 點來自遊戲追蹤。繼續後可以用手工值更正；這隻會影響外掛的歷史統計、預測和施工估算，不會修改遊戲內資料。",
      trackedGuildPointEditWarningHint: "清空後儲存：原追蹤值為 0 時改為自動補充，非零時恢復原值。",
      cancelTrackedGuildPointEdit: "取消",
      confirmTrackedGuildPointEdit: "繼續修改",
      manualGuildPointWeekInvalid: "請選擇已結束的試煉周，並輸入不小於 0 的整數。",
      manualGuildPointWeekRemoved: "手動歷史記錄已刪除，空缺周已恢復為自動補充。",
      manualGuildPointHistorySaved: "歷史公會點數表已儲存，留空的周將繼續自動估算。",
      constructionEta: "施工計劃預計",
      constructionEtaNoPlan: "尚無計劃",
      constructionEtaNoPlanHint: "新增建築後估算完成時間。",
      constructionEtaNeedsBalance: "尚未讀取當前可用點數，請手工填寫預算。",
      constructionEtaNeedsForecast: "需要已知本週進度及有效預測後估算。",
      constructionEtaHistoryConflict: "歷史點數與遊戲累計值衝突，暫停估算。",
      constructionEtaNoGrowth: "預測周產出為 0，暫時無法估算。",
      constructionEtaCovered: "當前點數已覆蓋",
      constructionEtaCoveredHint: "無需等待新的周點數即可完成計劃。",
      constructionEtaWeeks: "約 {count} 周",
      constructionEtaDetail: "尚缺 {shortfall} 點；先計本週剩餘，後續每週按下週預測 {points} 點估算。",
      constructionEtaDetailEstimated: "尚缺 {shortfall} 點；先計本週預計剩餘，後續暫按歷史均值每週 {points} 點。",
      exportGuildPointHistory: "匯出週記錄 CSV",
      resetGuildPointHistory: "重置週記錄",
      resetGuildPointHistoryConfirm: "確定重置當前角色的公會點數週記錄嗎？施工計劃不會被刪除，此操作無法撤銷。",
      guildPointHistoryReset: "當前角色的週記錄已重置，並從當前累計點數重新建立基線。",
      guildPointCsvWeekStart: "周開始時間",
      guildPointCsvEarned: "獲得公會點數",
      guildPointCsvStatus: "記錄狀態",
      guildPointCsvComplete: "已核實完整週",
      guildPointCsvTracking: "本週追蹤中",
      guildPointCsvManual: "手動錄入",
      guildPointCsvEstimated: "自動補充",
      guildPointCsvFileName: "銀河奶牛-公會點數週記錄.csv",
      plannedSpend: "計劃消耗",
      plannedUpgrades: "計劃升級",
      affordableUpgrades: "預算可完成",
      remainingPoints: "預算剩餘",
      overBudgetBy: "超出預算",
      constructionPlanScale: "{buildings} 座 · {steps} 級",
      constructionBudgetEmptySummary: "新增建築後顯示預算可執行範圍。",
      constructionNoBudgetSummary: "未設定預算 · 共 {total} 次升級",
      constructionBudgetAllFit: "預算覆蓋全部 {total} 次升級。",
      constructionBudgetStopsBefore: "可完成 {affordable}/{total} 次；下一項 {building} {from}→{to} 還差 {count}",
      buildingCatalog: "建築目錄",
      buildingCatalogHint: "選擇建築加入計劃；可連續新增多座。",
      addBuilding: "新增建築",
      closeBuildingPicker: "收起建築目錄",
      buildingCategoryFilter: "建築分類",
      buildingCategoryAll: "全部",
      buildingCategoryCore: "基礎",
      buildingCategoryLife: "生活",
      buildingCategoryCombat: "戰鬥",
      buildingCategoryShrine: "神龕",
      searchBuildings: "搜尋建築",
      currentLevel: "當前等級",
      buildingPlanCost: "計劃成本",
      buildingEditor: "建築計劃編輯器",
      selectBuildingPrompt: "請選擇一座建築。",
      buildingMaxLevel: "已滿級",
      notPlanned: "未計劃",
      buildingTileLabel: "{building}，當前 {current} 級，目標 {target}",
      buildingTileAddLabel: "新增 {building}，當前 {current} 級",
      buildingTileDefaultZeroLabel: "新增 {building}，當前 0 級",
      buildingTilePlannedLabel: "定位到 {building} 的施工行，目標 {target} 級",
      buildingTileMaxLabel: "{building} 已滿級，不能加入計劃",
      cancel: "取消",
      buildingAddedToPlan: "已將 {building} 加入施工計劃。",
      buildingRemovedFromPlan: "已將 {building} 移出施工計劃。",
      buildingTargetUpdated: "{building} 的目標已更新為 {target} 級。",
      buildingPlansReconciled: "已按即時等級調整 {adjusted} 項計劃，並移除 {removed} 項已完成計劃。",
      addOneLevel: "加 1 級",
      addFiveLevels: "加 5 級",
      removeBuildingPlan: "移出計劃",
      movePlanUp: "將 {building} 提前一位",
      movePlanDown: "將 {building} 延後一位",
      constructionQueue: "施工計劃",
      constructionQueueHint: "按建築分組排序；逐級費用預設收起。",
      constructionQueueDragHint: "拖動、箭頭按鈕或 Alt + 方向鍵排序",
      dragConstructionPlan: "調整 {building} 的施工順序",
      constructionQueueEmptyTitle: "施工計劃為空",
      constructionQueueEmpty: "選擇“新增建築”開始規劃。",
      constructionBudgetCutoff: "預算截止線 · 剩餘 {count}",
      constructionGroupBudgetCutoff: "預算可升至 {level} 級 · 下一等級還差 {count}",
      constructionBudgetUnbudgeted: "待預算",
      constructionWithinBudget: "預算內",
      constructionPartiallyWithinBudget: "部分預算內",
      constructionOverBudget: "超預算",
      constructionSummary: "{buildings} 座建築 · {steps} 次升級",
      constructionPlanRowMeta: "第 {position} 項 · {start}→{target} · {count} 次升級",
      buildingTargetLabel: "{building} 的目標等級",
      increaseBuildingTarget: "將 {building} 的目標提高 {count} 級",
      expandBuildingSteps: "展開 {building} 的逐級費用",
      collapseBuildingSteps: "收起 {building} 的逐級費用",
      removeBuildingFromPlan: "將 {building} 移出施工計劃",
      buildingLevelsCoverage: "已讀取 {known}/{total}",
      buildingLevelsPartialHint: "{unknown} 座建築未讀取到等級，已按 0 級處理。",
      missingBuildingCost: "{building} 缺少 {level} 級費用，未計入總成本。",
      moreConstructionActions: "更多施工計劃操作",
      clearBuildingPlans: "清空施工計劃",
      undoClearBuildingPlans: "撤銷清空",
      copyBuildingPlan: "複製規劃",
      exportBuildingCsv: "匯出 CSV",
      buildingPlanCopied: "施工規劃已複製。",
      buildingPlanCopyFailed: "無法寫入剪貼簿，請使用 CSV 匯出。",
      noBuildingMatches: "沒有符合篩選條件的建築。",
      buildingPlanCleared: "已清空 {count} 項施工計劃。",
      buildingPlanRestored: "已恢復 {count} 項施工計劃。",
      buildingPlanReordered: "施工順序已儲存。",
      buildingPlanMovedToPosition: "{building} 已移至第 {position} 項，共 {total} 項。",
      constructionOrder: "順序",
      fromLevel: "起始等級",
      toLevel: "目標等級",
      stepCost: "本級成本",
      cumulativeCost: "累計成本",
      buildingCsvFileName: "銀河奶牛_公會建築規劃.csv",
      buildingGuildHall: "公會大廳",
      buildingBuildersHall: "建造者殿堂",
      buildingArchives: "檔案館",
      buildingTreasury: "金庫",
      buildingSkillingEncampment: "生活營地",
      buildingWorkshop: "公會工作間",
      buildingForge: "公會鍛造臺",
      buildingLogShed: "公會木棚",
      buildingGarden: "公會花園",
      buildingDairyBarn: "公會奶牛棚",
      buildingKitchen: "公會廚房",
      buildingSewingParlor: "公會縫紉室",
      buildingBrewery: "公會沖泡坊",
      buildingLibrary: "公會圖書館",
      buildingLaboratory: "公會實驗室",
      buildingMysticalStudy: "公會神秘研究室",
      buildingCombatEncampment: "戰鬥營地",
      buildingGym: "公會健身房",
      buildingDojo: "公會道場",
      buildingArcheryRange: "公會射箭場",
      buildingArmory: "公會軍械庫",
      buildingDiningRoom: "公會餐廳",
      buildingObservatory: "公會天文臺",
      targetCredits: "目標信用點",
      increaseTargetCredits: "增加 100 目標信用點",
      decreaseTargetCredits: "減少 100 目標信用點",
      marketReference: "市場價格參考",
      priceReference: "價格參考",
      refreshEstimate: "重新整理市場估算",
      maxItemUnitPricePrefix: "遮蔽單價超過",
      maxItemUnitPriceSuffix: "M 的物品",
      maxItemUnitPricePlaceholder: "不遮蔽",
      maxItemUnitPriceInput: "遮蔽單價超過多少 M 金幣的兌換物品",
      increaseMaxItemUnitPrice: "增加 10M 遮蔽單價上限",
      decreaseMaxItemUnitPrice: "減少 10M 遮蔽單價上限",
      maxItemUnitPriceHint: "按當前左一或右一的單件市場價過濾；清空輸入可關閉過濾",
      maxItemUnitPriceInvalid: "請輸入大於 0 的 M 金額，例如 50",
      maxItemUnitPriceSaveFailed: "價格上限儲存失敗，本次會話仍然有效",
      waitingExchangeRules: "等待遊戲兌換資料...",
      guildShrineBatchPlan: "按當前公會神龕等級批次規劃",
      setGuildLifeTarget: "填充生活等級",
      setGuildCombatTarget: "填充戰鬥等級",
      guildAutofillAllExcluded: "所有{domain}神龕均已從一鍵填充中排除。",
      guildAutofillDomainExcluded: "當前沒有參與一鍵填充的{domain}神龕；請在設定中至少勾選一項。",
      selectedUpgradePlanCount: "已選擇 {count} 項升級計劃",
      addShrine: "新增神龕",
      clearAll: "清空全部",
      guideEnable: "開啟高亮指引",
      guideDisable: "關閉高亮指引",
      guideReady: "高亮指引已待命",
      guideReadyHint: "開啟後會根據規劃和即時庫存標出下一步，不會自動操作。",
      guideNoPlans: "尚未新增神龕計劃",
      guideNoPlansHint: "新增至少一項神龕升級後即可開始指引。",
      guideLoading: "正在計算指引步驟",
      guideLoadingHint: "等待神龕規則、庫存或市場資料完成讀取。",
      guideComplete: "當前計劃已經完成",
      guideCompleteHint: "目標神龕均已達到規劃等級。",
      guideMissingCredits: "下一步：補齊 {count} 種信用點",
      guideMissingCreditsHint: "請在公會商店選擇：{items}",
      guideChooseItem: "下一步：選擇 {item}",
      guideChooseItemHint: "這是當前 {credit} 的最優兌換物品。",
      guideSetQuantity: "下一步：輸入 {count} 批",
      guideSetQuantityHint: "預計消耗 {items} 個{item}，獲得 {credits} 點。",
      guideSetQuantityLimitHint: "總共還需 {remaining} 批；單次最多可填 {max} 批。",
      guideQuantityPlanSummary: "完成當前規劃需要「{item}」{items}個，獲得「{credit}」{credits}個",
      guideQuantityCurrentExchange: "本次填寫 {count} 批",
      guideTokenQuantityDetail: "本次填寫 {batches} 批，將使用 {items} 枚公會代幣",
      guideUseGuildTokens: "下一步：使用 {count} 枚公會代幣",
      guideUseGuildTokensHint: "當前已為 {credit} 選擇公會代幣兌換。",
      guideUnavailable: "暫時無法生成兌換指引",
      guideUnavailableHint: "當前信用點沒有可用市場方案，請重新整理市場資料或切換兌換方式。",
      guideBlocked: "仍有非信用點材料缺口",
      guideBlockedHint: "請先補齊：{items}",
      guideUpgradeShrine: "材料已齊，可以升級神龕",
      guideUpgradeShrineHint: "請前往升級：{shrines}",
      nativeGuildShopTab: "商店",
      waitingUpgradeRules: "等待神龕升級資料...",
      author: "作者：柆雨",
      support: "遇到問題或無法獲取最新版，請加群：437320340",
      fallbackInstaller: "無法開啟 Greasy Fork？使用備用分發安裝",
      noMarketEstimate: "暫無可估算的市場價格",
      noMarketEstimateWithinPriceLimit: "沒有單價不超過 {limit}M 的可用兌換物品；清空價格上限可顯示全部",
      item: "物品",
      exchange: "兌換",
      perCredit: "每點",
      targetCost: "目標成本",
      tokenExchangeValue: "{token}兌換價值",
      noMarketValue: "暫無市場估算",
      noExchangeRules: "未讀取到兌換規則。請重新整理遊戲頁面後重新開啟公會商店。",
      readingRules: "已讀取 {count} 條兌換規則，正在讀取公開市場快照...",
      snapshotLoadFailed: "市場快照讀取失敗：{message}",
      snapshotFallbackUsed: "無法獲取新快照，當前顯示約 {minutes} 分鐘前儲存的舊資料；為避免繼續觸發限制，已暫緩請求。",
      snapshotFallbackNotice: "新市場資料暫時不可用，當前使用已儲存的舊價格。",
      credits: "信用點",
      goldPerCredit: "金幣 / 信用",
      singleExchange: "單次兌換",
      marketCost: "市場成本",
      exchangeRecommendation: "兌換最優推薦",
      collapseExchangeAdvisor: "收起兌換推薦",
      expandExchangeAdvisor: "展開兌換推薦",
      advisorReferenceSelected: "賣出右一（稅 {tax}%）·買入{reference}",
      advisorReference: "買入參考{reference}",
      chooseItem: "請選擇兌換物品以計算賣出後替代方案。",
      alreadyOptimal: "當前選擇已是最優物品，無需賣出再回購。",
      sellAndBuyMore: "賣出後改買可多獲得 <strong>+{count}</strong> {credit}。",
      directMore: "直接兌換可多獲得 <strong>{count}</strong> {credit}。",
      sameCredits: "兩種方案可獲得相同的信用點。",
      selected: "當前選擇",
      selectedOptimal: "當前選擇（最優）",
      bestItem: "最優物品",
      directExchange: "直接兌換",
      afterTax: "稅後所得",
      buybackExchange: "回購兌換",
      purchaseCost: "買入成本",
      noSellPrice: "當前物品暫無公開收購價，無法估算賣出後回購。",
      noAffordableReplacement: "售出當前數量後稅後可得 {gold}，不足以回購其他可兌換物品。",
      trialHistory: "歷史試煉資料",
      trialScreenshotGuide: "快速截圖幫助",
      trialScreenshotCopy: "快速截圖",
      trialScreenshotDownload: "下載截圖",
      trialScreenshotHelp:
        "擷取當前所選檢視的完整表格。按周：上排四個生活專案，下排兩個戰鬥專案；按專案：僅最新五個週期橫排；玩家排行：全部列表橫排。圖片按內容寬度生成，保留原版圖示，省略操作區和原始資料；保留當前顯示欄位與匿名設定。",
      trialScreenshotReady: "分享前可開啟隱藏玩家名。複製不可用時將自動下載；儲存位置由瀏覽器下載設定決定。",
      trialScreenshotWorking: "正在生成完整截圖…",
      trialScreenshotCopied: "截圖已複製，可直接貼上。",
      trialScreenshotDownloaded: "已發起 PNG 下載，請檢視瀏覽器下載列表。",
      trialScreenshotFallback: "無法寫入剪貼簿，已改為下載 PNG，請檢視瀏覽器下載列表。",
      trialScreenshotTooLarge: "當前檢視過大，無法生成清晰截圖。請切換到單週或單個玩家後重試。",
      trialScreenshotIconFailed: "原版圖示載入失敗，請檢查網路後重試截圖。",
      trialScreenshotFailed: "截圖成失敗。請重試或切換到單週檢視後下載 PNG。",
      trialSimpleNames: "簡潔模式",
      trialSimpleNamesHint: "只顯示普通玩家名字，隱藏個性化圖示和顏色；本次頁面內生效。",
      trialScreenshotMode: "隱藏玩家名",
      trialScreenshotExit: "退出隱藏玩家名",
      trialScreenshotHint: "僅隱藏曆史試煉頁面的玩家名；匯出 JSON 保留原名。重新整理遊戲後關閉。",
      trialAnonymousPlayer: "玩家 {number}",
      trialGuide: "說明",
      trialDisplayNotice:
        "目前提供資料收集、展示及基礎彙總。如需進一步分析，可匯出資料交給 AI，並說明你希望瞭解的問題或呈現的效果。",
      trialFeedbackNotice:
        "也歡迎加入 QQ 群 437320340，分享你與 AI 的分析對話或結果，幫助我瞭解大家的實際需求，為後續開發提供參考。感謝你的支援！",
      trialDisplaySettings: "顯示設定",
      trialMemberColumns: "成員列表 · 列管理",
      trialColumnsCount: "生活 {skilling}/5 列 · 戰鬥 {combat}/11 列",
      trialColumnsHint: "逐項切換，即時生效。所有歷史成員表共用，僅儲存在本機。",
      trialColumnsPresets: "列顯示預設",
      trialColumnsPreset_compact: "精簡",
      trialColumnsPreset_all: "完整",
      trialColumnsPreset_default: "恢復預設",
      trialColumnsGroup_basic: "基礎資訊 · 通用",
      trialColumnsGroup_skilling: "生活試煉",
      trialColumnsGroup_damageDealt: "戰鬥 · 傷害",
      trialColumnsGroup_healingDone: "戰鬥 · 治療",
      trialColumnsGroup_premitigatedDamageTaken: "戰鬥 · 承傷",
      trialColumnsGroup_levelSummary: "等級彙總 · 表格上方",
      trialColumnsGroup_workDoneSummary: "工作量彙總 · 表格上方",
      trialColumnsCalculations: "統計口徑與缺失值說明",
      trialColumnsEmpty: "當前成員表的列已全部隱藏，可在上方列管理中重新開啟。",
      trialDisplaySaveFailed: "設定未能儲存，當前頁面已生效；重新開啟頁面後可能恢復預設。",
      trialOverview: "專案總體概覽",
      trialKnownCoverage: "{field}：已知 {count}/{total} 人，彙總僅含已知值。",
      trialPartialShare: "部分指標不完整：總量佔比僅按該項已知值計算，人均基準僅按該項已知且大於 0 的成員計算。",
      trialField_combatShare: "戰鬥總量佔比",
      trialField_combatMultiple: "戰鬥相對人均",
      trialField_damageDealtShare: "傷害佔比",
      trialField_damageDealtMultiple: "傷害相對人均",
      trialField_healingDoneShare: "治療佔比",
      trialField_healingDoneMultiple: "治療相對人均",
      trialField_premitigatedDamageTakenShare: "承傷佔比",
      trialField_premitigatedDamageTakenMultiple: "承傷相對人均",
      trialField_workShare: "總量佔比",
      trialLowWork: "本次工作量佔比 {share}%，低於 0.9%",
      trialSignupLowWork: "最近一次參加本專案（第 {week} 周）的工作量佔比 {share}%，低於 0.9%",
      trialField_workMultiple: "相對人均",
      trialField_levelSummary: "等級彙總",
      trialField_workSummary: "工作量彙總",
      trialAggregate_level_total: "總等級",
      trialAggregate_level_average: "平均等級",
      trialAggregate_level_median: "中位數等級",
      trialAggregate_workDone_total: "總工作量",
      trialAggregate_workDone_average: "平均工作量",
      trialAggregate_workDone_median: "中位數工作量",
      trialDisplayMode: "歷史資料展示方式",
      trialByWeek: "按周檢視",
      trialByProject: "按專案檢視",
      trialByPlayer: "按玩家檢視",
      trialPlayerRankings: "玩家排行榜",
      trialPlayerOverview: "參試總覽",
      trialOverviewProject: "專案",
      trialOverviewAverage: "平均相對人均",
      trialOverviewTotal: "總相對人均",
      trialOverviewAllProjects: "全部專案",
      trialOverviewMethod: "統計口徑",
      trialOverviewHelp:
        "僅統計本地儲存的遊戲採集記錄，不含手動整理記錄。每參與一個專案計 1 次，含零貢獻；0 次表示沒有采集到參試記錄。各項人均僅計入該項數值大於 0 的成員。\n生活按工作量除以該場人均；戰鬥將傷害、治療、承傷的有效人均倍數直接相加，再對同項目各場倍數等權平均。\n總相對人均為有效場次倍數之和；全部專案行彙總次數和倍數，平均值按有效場次加權。1× 為人均水平；缺失值和零分母跳過，無有效倍數顯示 —。",
      trialRankingJoinedAt: "入會時間排行",
      trialRankingJoinedAtHelp:
        "僅列出當前公會成員，按入會時間從早到晚排列，同一時間並列。未知時間置後且不排名；時間按本地時區顯示。未參加試煉的成員也會列出。",
      trialRankingRosterEmpty: "尚未讀取到當前公會成員，請先開啟遊戲公會頁面。",
      trialRankingDrag: "拖動調整{name}的位置",
      trialRankingMoveLeft: "將{name}左移",
      trialRankingMoveRight: "將{name}右移",
      trialRankingOrderHint:
        "拖動榜單下方的手柄調整順序，也可使用左右按鈕或聚焦手柄後按 Alt＋左右方向鍵。順序自動儲存。",
      trialRankingOrderSaveFailed: "順序已調整，但儲存失敗；重新整理頁面後可能恢復。請檢查瀏覽器儲存空間後重試。",
      trialRankingParticipations: "參與次數",
      trialRankingAverageTitle: "{scope} · 平均相對人均",
      trialRankingTotalTitle: "生活＋戰鬥 · 相對人均合計",
      trialRankingTotalMultiple: "合計倍數",
      trialRankingScope_skilling: "生活",
      trialRankingScope_combat: "戰鬥",
      trialRankingScope_damageDealt: "傷害",
      trialRankingScope_healingDone: "治療",
      trialRankingScope_premitigatedDamageTaken: "承傷",
      trialRankingScope_all: "生活＋戰鬥",
      trialRankingRank: "名次",
      trialRankingCount: "次數",
      trialRankingMultiple: "平均倍數",
      trialRankingSamples: "樣本數",
      trialRankingMethod: "統計口徑",
      trialRankingCountHelp:
        "僅使用外掛從遊戲採集的記錄，手動整理記錄不參與排行榜。每參與一個生活或戰鬥專案計 1 次，包含零貢獻記錄；未採集的專案不計。同值並列。",
      trialRankingAverageHelp:
        "生活、戰鬥分別按在會且具備資格的試煉周計算：周開始前已入會的成員，確認缺席記 0，每類每週分母只加 1。各項人均基準僅計入該項數值大於 0 的成員。生活使用工作量人均倍數；戰鬥每個專案將傷害、治療、承傷的有效人均倍數直接相加，再對當周有效專案取平均，最後對各周等權平均。\n傷害、治療、承傷三個獨立榜分別只使用對應指標的人均倍數，承傷採用減傷前承傷；每項獨立排除缺失或分母為零的資料。\n缺席只在當週該類專案已完整採集、且入會時間或參試記錄能確認在會時計入；未知在會狀態、未完整採集及無法計算倍數的周不補零。只覆蓋已採集完成的周，舊手動記錄完全不參與。\n合併榜為生活均值＋戰鬥均值，不除以 2；只有一類有效時保留該類。\n樣本數按已採集的實際參試記錄計數：每週每類最多 1 個，參加但貢獻為零或數值未知也計入，未參加不計入；合併榜為兩類樣本數之和。樣本數不等於平均值分母，確認缺席周仍按 0 參與平均。",
      trialPlayerFind: "選擇玩家",
      trialPlayerSwitch: "當前玩家：{name} · 切換玩家",
      trialPlayerSearchLabel: "搜尋歷史玩家",
      trialPlayerSearchPlaceholder: "輸入玩家名字，支援部分匹配",
      trialPlayerSearchButton: "搜尋",
      trialPlayerSearchClear: "清空",
      trialPlayerSearchCount: "顯示 {count} / {total} 位玩家",
      trialPlayerSearchEmpty: "未找到匹配的玩家，請修改關鍵詞或清空搜尋。",
      trialChoosePlayer: "玩家",
      trialSelectPlayerPrompt: "選擇玩家檢視參試歷史",
      trialNoNamedPlayers: "暫無已記錄姓名的玩家",
      trialChooseWeek: "周次",
      trialChooseProject: "專案",
      trialUnknownWeek: "周次不明",
      trialUnrecordedProject: "未記錄專案",
      trialMissingRecord: "暫無記錄",
      trialScrollLeft: "向左檢視",
      trialScrollRight: "向右檢視",
      trialNewer: "較新周次",
      trialOlder: "較舊周次",
      trialDataTransfer: "試煉資料匯入與匯出",
      trialImport: "匯入 JSON",
      trialImportFile: "選擇試煉歷史 JSON 檔案",
      trialImportHint:
        "支援歷史匯出檔案和手動整理記錄（最大 10 MB）。先預覽再儲存；可補全未知日期及周次，重複或統計衝突記錄會跳過。",
      trialImportReading: "正在讀取檔案…",
      trialImportPreview: "匯入預覽",
      trialImportSummary: "新增 {added} 項 · 補全周次 {dated} 項 · 重複 {duplicates} 項 · 衝突 {conflicts} 項",
      trialImportStatus_new: "新增",
      trialImportStatus_dated: "補全日期與周次",
      trialImportStatus_duplicate: "重複，跳過",
      trialImportStatus_conflict: "內容不同，保留已有記錄",
      trialImportMemberCount: "{count} 位成員",
      trialImportConfirm: "確認匯入 {count} 項",
      trialImportCancel: "取消",
      trialImportTooLarge: "檔案過大，請選擇不超過 10 MB 的 JSON 檔案。",
      trialImportInvalidJson: "檔案不是有效 JSON，或包含不安全的欄位。請檢查檔案內容。",
      trialImportInvalidFile: "格式不支援。請選擇本外掛匯出的檔案，或符合手動整理格式的檔案（1–1,000 項記錄）。",
      trialImportInvalidRecord: "第 {index} 項記錄格式有誤：請檢查日期、成員、專案標識和非負統計數值；本次未匯入。",
      trialImportDuplicateKey: "第 {index} 項記錄與檔案內另一項使用相同標識，請先刪除重複項；本次未匯入。",
      trialImportReadFailed: "無法讀取檔案，請重新選擇。",
      trialImportComplete:
        "已匯入 {added} 項，補全周次 {dated} 項，跳過 {duplicates} 項重複記錄和 {conflicts} 項衝突記錄。",
      trialImportSaveFailed: "儲存失敗，本次更改已撤回；請檢查瀏覽器儲存空間後重試。",
      trialImportPartial: "儲存失敗，本次仍保留新增 {added} 項、補全周次 {dated} 項。重試會跳過已儲存項。",
      trialUnknownDate: "日期未註明",
      trialUnknownGuild: "公會未註明",
      trialManualSource: "手動整理",
      trialAutomaticSource: "遊戲採集",
      trialHistoryHint:
        "試煉結束後，開啟遊戲中的“統計”即可自動歸檔本次返回的全部已完成專案。記錄儲存在當前瀏覽器，按伺服器和角色隔離；未採集的往期資料可通過手動整理檔案匯入。",
      trialHistoryEmpty: "暫無記錄。可匯入歷史檔案，或在試煉結束後開啟遊戲中的“統計”。",
      trialSavedCount: "{count} 條記錄",
      trialSaveFailed: "部分記錄尚未儲存到瀏覽器。請先匯出備份，再檢查瀏覽器儲存空間；當前頁面仍保留待儲存資料。",
      trialLoadFailed: "部分本地記錄讀取失敗，已保留原資料。當前僅顯示可讀取的記錄。",
      trialExport: "匯出全部 JSON",
      trialSkilling: "生活試煉",
      trialCombat: "戰鬥試煉",
      trialSummary: "{count} 人 · {points} 點 · {tier} 層 · 下一層 {progress}",
      trialStatsTable: "成員試煉統計",
      trialMember: "成員",
      trialNameUnavailable: "名稱未讀取",
      trialPlayerBack: "返回歷史列表",
      trialPlayerHistory: "參試歷史",
      trialPlayerProfile: "個人資料",
      trialProfileRefresh: "重新整理資料",
      trialProfileLoading: "正在讀取資料…",
      trialProfileTimeout: "資料查詢超時，可點選重新整理資料重試。",
      trialProfileMismatch: "返回的資料與歷史角色 ID 不一致，未展示。",
      trialPlayerEmpty: "暫無該玩家的參試記錄。",
      trialProfileGuild: "公會",
      trialProfileTotalLevel: "總等級",
      trialProfileCombatLevel: "戰鬥等級",
      trialProfileJoinedAt: "入會時間",
      trialProfileJoinedAtUnknown: "未知",
      trialProfileJoinedAtHelp: "加入當前公會的時間，按本地時區顯示。未取得當前名冊中的有效時間時顯示未知。",
      trialProfileSkills: "技能等級",
      trialProfileEquipment: "裝備",
      trialSlot_back: "背部",
      trialSlot_head: "頭部",
      trialSlot_trinket: "飾品",
      trialSlot_neck: "項鍊",
      trialSlot_main_hand: "主手",
      trialSlot_body: "身體",
      trialSlot_off_hand: "副手",
      trialSlot_earrings: "耳環",
      trialSlot_hands: "手部",
      trialSlot_legs: "腿部",
      trialSlot_pouch: "收納袋",
      trialSlot_ring: "戒指",
      trialSlot_feet: "腳部",
      trialSlot_charm: "護符",
      trialSlot_milking_tool: "擠奶",
      trialSlot_foraging_tool: "採摘",
      trialSlot_woodcutting_tool: "伐木",
      trialSlot_cheesesmithing_tool: "乳酪鍛造",
      trialSlot_crafting_tool: "製作",
      trialSlot_tailoring_tool: "縫紉",
      trialSlot_cooking_tool: "烹飪",
      trialSlot_brewing_tool: "沖泡",
      trialSlot_alchemy_tool: "鍊金",
      trialSlot_enhancing_tool: "強化",
      trialProfileAbilities: "技能配置",
      trialProfileActivity: "當前活動",
      trialProfilePresence: "線上狀態",
      trialProfileObservation: "活動與線上狀態以最近讀取的資料為準。",
      trialActivityUnknown: "未公開或未知",
      trialActivity_combat: "戰鬥",
      trialActivity_labyrinth: "迷宮",
      trialActivity_special: "特殊活動",
      trialPresence_online: "線上",
      trialPresence_offline: "離線",
      trialPresence_hidden: "已隱藏",
      trialPresence_unknown: "未知",
      trialProfileHouse: "房屋",
      trialProfileHouseLevel: "房屋等級：{level}",
      trialProfileRaw: "完整資料資料",
      trialProfileTooltipUnavailable: "詳細資料暫不可用",
      trialProfile_totalTaskPoints: "任務點數",
      trialProfile_labyrinthPoints: "迷宮點數",
      trialProfile_labyrinthHighestFloor: "迷宮最高層",
      trialProfile_collectionPoints: "收集點數",
      trialProfile_bestiaryPoints: "圖鑑點數",
      trialProfile_famePoints: "聲望點數",
      trialSkill_stamina: "耐力",
      trialSkill_intelligence: "智力",
      trialSkill_attack: "攻擊",
      trialSkill_melee: "近戰",
      trialSkill_defense: "防禦",
      trialSkill_ranged: "遠端",
      trialSkill_magic: "魔法",
      trialMemberAbsent: "已退出工會",
      trialOpenProfile: "檢視 {name} 的參試歷史",
      trialProfileUnavailable: "暫時無法開啟玩家資料，請確認遊戲已連線並重新整理頁面後重試。",
      trialSortAscending: "按{field}升序排列",
      trialSortDescending: "按{field}降序排列",
      trialField_level: "等級",
      trialField_workDone: "工作量",
      trialField_damageDealt: "造成傷害",
      trialField_healingDone: "治療量",
      trialField_premitigatedDamageTaken: "減傷前承傷",
      trialName_milking: "擠奶",
      trialName_badger: "試煉獾",
      trialName_chameleon: "試煉變色龍",
      trialName_jellyfish: "試煉水母",
      trialName_hedgehog: "試煉刺蝟",
      trialName_swarm: "試煉蟲群",
      trialName_foraging: "採摘",
      trialName_woodcutting: "伐木",
      trialName_cheesesmithing: "乳酪鍛造",
      trialName_crafting: "製作",
      trialName_tailoring: "縫紉",
      trialName_cooking: "烹飪",
      trialName_brewing: "沖泡",
      trialName_alchemy: "鍊金",
      trialName_enhancing: "強化",
      sidebarCredit: "公會"
    },
    en: {
      settingsHelp: "Help",
      helpRankingOrder: "Ranking order",
      helpSettingsAndMarket: "Settings and market reference",
      helpForecastEvidence:
        "Forecasts use confirmed records and nonzero game-tracked values within the lookback window. Estimated records are excluded; tracked zeros require manual confirmation.",
      helpForecastBacktest:
        "Historical backtests show how linear regression performs on existing records without changing the forecast method.",
      helpConstructionEta:
        "The estimated wait uses the plan’s point shortfall, adds the expected remainder of this week first, then uses next week’s forecast for each following week.",
      helpTrialCoverage: "When some member values are unknown, aggregates include only known values for that metric.",
      helpCreditExchangeMode:
        "Each credit card shows its current exchange method. Click it to switch between the optimal item and guild tokens.",
      unknownItem: "Unknown item",
      priceReferenceA: "Lowest ask",
      priceReferenceATitle: "Lowest ask: the current price to buy immediately",
      priceReferenceB: "Highest bid",
      priceReferenceBTitle: "Highest bid: quotes below the tradable range are ignored",
      marketItem: "View {item} in Marketplace",
      updateChecking: "Current v{current} · Latest: checking...",
      updateAvailable: "Current v{current} · Latest v{latest} · Update available",
      updateNow: "Update now",
      updateLatest: "Current v{current} · Latest v{latest} · Up to date",
      updateUnavailable: "Current v{current} · Latest: unavailable",
      shrineCollapse: "Collapse",
      shrineExpand: "Expand",
      shrineCollapseNamed: "Collapse {shrine} plan",
      shrineExpandNamed: "Expand {shrine} plan",
      shrineNoMaterials: "No materials required",
      shrineAlreadyPlanned: "Already in another plan",
      shrineMaxed: "Maximum level reached",
      shrineGain: "Gain {value}",
      shrineRemoveNamed: "Remove {shrine} plan",
      shrineLevelStatus: "Purchased Lv. {current} · Guild cap {cap}",
      shrineNextLevel: "One level",
      shrineToGuildCap: "To guild cap",
      shrineStartAssumed:
        "Your purchased level is unavailable. Adjust the starting level to match your actual level before using this estimate.",
      shrineCapUnknown: "Guild shrine level is unavailable; target availability is unconfirmed.",
      shrineAboveCap:
        "Target exceeds the current guild cap of {level}. This is a future plan; the excess levels are not active yet.",
      shrineEffectComparison: "Effect change",
      shrineLevelRange: "Lv. {start} → {target}",
      shrineRangeCost: "Materials for this plan",
      shrineSteps: "Per-level effects & costs · {count} levels",
      shrineStepsHint: "Each step shows the total effect at that level and the materials for that step only.",
      shrineStepLevel: "Lv. {start} → {target}",
      shrineEffectsPerLevel: "Per level: {effects}",
      shrineEffectsFirstAndPerLevel: "Level 1: {first}; each later level: {later}",
      shrineEffectPerLevel: "Per level: {effect} {value}",
      shrineEffectFirstAndPerLevel: "{effect}: level 1 {first}; each later level {value}",
      shrineEffectsUnavailable: "Per-level effects not yet available",
      shrineEffectActionSpeed: "Action speed",
      shrineEffectAttackSpeed: "Attack speed",
      shrineEffectCastSpeed: "Cast speed",
      shrineEffectEfficiency: "Efficiency",
      shrineEffectDamage: "Damage",
      shrineEffectEssenceFind: "Essence find",
      shrineEffectMaxHp: "Max HP",
      shrineEffectMaxMp: "Max MP",
      shrineEffectRareFind: "Rare find",
      shrineEffectExperience: "Experience",
      shrineForce: "Force Shrine",
      shrineTempo: "Tempo Shrine",
      shrineSpirit: "Spirit Shrine",
      shrineRarity: "Rarity Shrine",
      shrineScholar: "Scholar Shrine",
      domainLife: "Life",
      domainCombat: "Combat",
      shrineWithDomain: "{shrine} ({domain})",
      guildTargetApplied: "Set {domain} plans to the current guild shrine levels; {count} upgrade(s) are needed.",
      guildTargetComplete:
        "All {domain} shrines already meet their guild building levels; no extra materials are needed.",
      plansCleared: "Cleared all shrine upgrade plans.",
      level: "Lv. {level}",
      targetButtonReady: "Set every matching shrine target to its current guild level",
      targetButtonMissing: "Guild shrine building levels are incomplete: {missing}",
      targetSummary: "{domain} {count}/{total}{missing}",
      targetSummaryMissing: " (unread: {missing})",
      shrineLevelsRead: "Guild shrine levels read: {summaries}.",
      shrineLevelsReading: "Reading current guild shrine building levels…",
      shrine: "Shrine",
      startLevel: "Starting level",
      targetLevel: "Target level",
      removePlan: "Remove this plan",
      gold: "gold",
      guildTokens: "guild tokens",
      noSnapshotEstimate: "The public market snapshot is unavailable, so the gold cost cannot be estimated.",
      partialEstimatedCost: "Estimated cost (priced items only)",
      estimatedTotalCost: "Estimated total cost",
      partialAfterInventory: "After-inventory gap (priced items only)",
      afterInventory: "Still needed after inventory",
      inventoryUnavailable: "Backpack inventory is unavailable; the gap assumes you own 0 items.",
      noCreditPrice: "No usable market price for: {items}.",
      costSummary: "Cost summary",
      inventoryAndMissing: "Owned {owned} · Missing {missing}",
      inventory: "Owned {count}",
      missingCount: "Missing {count}",
      inventoryNotRead: "Inventory unavailable",
      inventoryCoveredNoExchange: "Existing inventory covers this requirement; no exchange is needed",
      backpackInventory: "Backpack: {count}",
      notRead: "unavailable",
      useGuildTokensForMissingCredits: "Use guild tokens for every credit",
      useGuildTokensForMissingCreditsHint: "Select or clear all, or switch each credit card individually below.",
      guildTokenCreditPlanActive: "Every missing credit is calculated as a guild-token exchange.",
      guildTokenCreditPlanPartialActive: "{count} credit type(s) use guild-token exchanges.",
      guildTokenCreditPlanSummary: "{count} guild tokens are allocated to credit exchanges.",
      autoGuildTokenBudget: "Automatic token budget",
      autoGuildTokenBudgetHint: "Allocates tokens from highest to lowest current market exchange value.",
      autoGuildTokenBudgetAvailable: "Up to {count} available",
      autoGuildTokenPlanSummary: "Automatically allocated {count} inventory guild tokens by exchange value.",
      autoGuildTokenExchangeNeeds: "Auto-allocated tokens",
      autoGuildTokenCoverage: "Covers {count} credits",
      optimalItemCreditMode: "Best item",
      guildTokenCreditMode: "Guild tokens",
      creditExchangeModeTitle: "Current mode: {mode}. Click to switch.",
      guildTokenExchangeNeeds: "Tokens needed",
      optimalExchangeNeeds: "Best exchange needs",
      exchangeRate: "{items} → {credits}",
      itemQuantity: "{count} {unit}",
      creditQuantity: "{count} {unit}",
      optimalExchangeUnavailable: "Best exchange: no usable market price",
      requiredThisTime: "Needed now",
      noGuildRules: "Shrine upgrade rules are unavailable. Refresh the game, then reopen the guild.",
      noUpgradePlans: "There are no shrine upgrade plans yet.",
      noUpgradePlansHint: "Select Add shrine, or use a batch-fill button above to create plans.",
      allBuffsMaxed: "All shrine buffs are already at their maximum level.",
      noUpgradeMaterials: "There are no shrine upgrade materials to calculate.",
      missingLevelCost: "Missing upgrade cost data for level {level}.",
      invalidLevels: "The starting or target level is invalid.",
      mergedUpgradePlans: "Combined material costs for {count} shrine upgrade plan(s).",
      unknownCurrentLevels:
        "Current shrine levels are unavailable, so plans start at level 0. Please verify or adjust the starting level.",
      snapshotFailed: "The public market snapshot failed to load, so the gold cost is not estimated yet.",
      panelTitle: "Guild Assistant",
      creditValue: "Credit value",
      creditValueHint:
        "Compare public market costs for the target amount; the first item is the current best exchange.",
      shrineUpgrade: "Shrine upgrades",
      guildConstruction: "Guild construction",
      panelViewOrder: "Tab order",
      interfaceSettings: "Settings",
      interfaceSettingsHint:
        "Choose what batch fill includes and which plugin pages are visible. Changes apply locally.",
      openInterfaceSettings: "Open settings",
      closeInterfaceSettings: "Back to previous page",
      backFromSettings: "Back",
      shrineAutofillRange: "Batch-fill scope",
      shrineAutofillRangeHint:
        "Clear an item to stop batch fill from adding or updating it. Existing plans are never deleted.",
      settingsShrinesLoading: "Reading configurable guild shrines…",
      settingsShrinesEmpty: "Game data is available, but there are no configurable guild shrines.",
      interfaceVisibility: "Interface",
      sidebarDisplayName: "Sidebar tab name",
      sidebarDisplayNameHint: "Up to 24 characters. Leave blank to use the default name. Applies when saved.",
      sidebarNameSave: "Save name",
      sidebarNameReset: "Reset name",
      showConstructionView: "Show Guild construction",
      showTrialHistoryView: "Show Trial history",
      showTrialHistoryViewHint:
        "On by default. Hiding the tab keeps history and automatic saving active; you can show it again anytime.",
      trialHistoryViewShown: "The Trial history tab is now visible.",
      trialHistoryViewHidden: "The Trial history tab is hidden; history and automatic saving are unaffected.",
      showConstructionViewHint:
        "On by default. Turning this off hides the tab but keeps every construction plan for later.",
      settingsSaved: "Settings saved.",
      settingsSaveFailed: "The change is active but could not be saved; it may reset after a page refresh.",
      constructionViewShown: "The Guild construction page is now visible.",
      constructionViewHidden: "The Guild construction page is hidden; its plans are still saved.",
      constructionReadOnly: "Admin planning tool · calculates only and never upgrades buildings",
      guildPointBudget: "Available guild points",
      manualBudget: "Manual budget",
      budgetOptional: "Leave blank to use the current points read from the game",
      invalidGuildPointBudget: "Enter a whole number of 0 or more.",
      guildPointTrend: "Weekly Guild Points",
      guildPointOverview: "Guild points & budget",
      guildPointStatisticsHeading: "Points & history",
      buildingCatalogCurrentLevel: "Current level {current}",
      buildingCatalogUnknownPlannedLevel: "Level {current} → {target} · In plan",
      buildingCatalogPlannedLevel: "Level {current} → {target} · In plan",
      buildingCatalogUnknownLevel: "Current level {current}",
      buildingCatalogNextLevelCost: "Level {level}: {points} points",
      buildingCatalogNextLevelCostUnavailable: "Next-level cost unavailable",
      guildPointPlanningHeading: "Construction budget",
      guildPointStartingBalance: "Custom starting points",
      guildPointFollowBalance: "Use game balance",
      guildPointStartingBalanceHint: "Optional. Clear to use the available game balance.",
      guildPointStartingBalanceCompactHint: "Blank uses game balance",
      guildPointPlanningWeeksCompactHint: "0 = now; 1 = rest of this week",
      guildPointTrendHint: "Points stay local; linear regression uses recent valid weeks",
      guildPointAutoSaved: "Auto-saved",
      guildPointSavedSnapshot: "Saved snapshot",
      currentAvailableGuildPoints: "Available now",
      currentWeekGuildPoints: "Earned this week",
      predictedCurrentWeekGuildPoints: "This week: expected total",
      latestWeeklyGuildPoints: "Latest complete week",
      weeklyGuildPointGrowth: "Week-over-week",
      guildPointEstimatedGrowth: "Estimated weekly growth",
      nextWeekGuildPointForecast: "Next-week forecast",
      guildPointHistoryUnavailable:
        "Guild Points are not available yet. Open the Guild page to create a local baseline.",
      guildPointHistoryBaseline:
        "The lifetime-point baseline is saved. The next weekly reward will create the first record.",
      guildPointForecastNeedsHistory:
        "Linear regression needs at least two valid weeks within the lookback window. No historical-average fallback is used.",
      guildPointForecastColdStart:
        "The prior {count} weeks averaged {average} points; {current} earned this week. This average is a reference only.",
      guildPointForecastMethod: "Uses verified records within the latest {count} weeks.",
      guildPointForecastEstimatedMethod:
        "Historical-average reference from lifetime points; auto-filled weeks are excluded from trend fitting.",
      guildPointHistoryConflict:
        "Historical weekly points exceed the game's lifetime total, so forecasting is paused. Check manual entries or reset weekly records.",
      remainingCurrentWeekGuildPoints: "This week: expected remainder",
      guildPointSourcePartial: "Game tracked",
      guildPointCsvPartial: "Game tracked",
      guildPointMethodMean: "recent mean",
      guildPointMethodLinear: "linear regression",
      guildPointMethodHistorical: "historical-average reference",
      guildPointForecastEvidence:
        "Lookback: {count} weeks; {reliable} confirmed, {partial} game tracked. Excludes {estimated} estimated weeks. Method: {method}. Tracked zeros require manual confirmation.",
      guildPointForecastDetails: "Forecast basis and limits",
      guildPointHelpHistorical: "Too few verified past weeks; using the historical average as a reference.",
      guildPointHelpInsufficient: "Using the recent mean; {count}/3 valid evaluations, so no trend fitting yet.",
      guildPointHelpEvaluated: "Using {method}, evaluated against {count} past weeks.",
      guildPointHelpDataTitle: "Which records are used",
      guildPointHelpData:
        "Positive current-week points mark this week as finished and include it in the lookback window; otherwise the window ends last week. Confirmed records and positive game-tracked values are used. Estimates and missing values are excluded. Tracked zeros require manual confirmation.",
      guildPointHelpMethodTitle: "How the forecast is calculated",
      guildPointHelpMethod:
        "Least-squares linear regression fits earned points against actual week numbers and extrapolates the target week, rounded to a nonnegative integer. At least two valid weeks are required. Evaluation no longer switches the method to a mean.\nMissing weeks retain their time gaps. No zeros or older samples are filled in. Insufficient data is shown as —.",
      guildPointHelpResultTitle: "How to read the result",
      guildPointHelpResult:
        "Once points are earned this week, its expected total equals those points and its expected remainder is zero. Earned points are not added to the planning budget again.\nEvaluation checks the saved history only. Future results may differ as membership and participation change.",
      trialHelpScreenshotPreview: "Check what is captured, what to review before sharing and how it is saved.",
      trialHelpScreenshotScope: "What is captured",
      trialHelpSharing: "Sharing and saving",
      trialHelpHistoryPreview: "Learn how records are collected, stored and imported.",
      trialHelpCollection: "Collection and storage",
      trialHelpImport: "Importing past records",
      trialHelpPurpose: "Using these records",
      trialHelpFeedback: "Feedback and discussion",
      trialHelpColumnsPreview: "Shares and averages use different denominators; unknown is not zero.",
      trialHelpShare: "Share of the total",
      trialHelpShareBody: "Member value divided by the known total.",
      trialHelpAverage: "Average multiple",
      trialHelpAverageBody:
        "Member value divided by the average among members with a positive value for that metric; 1× is average. Work, damage, healing and pre-mitigation damage taken are calculated separately, excluding zero-valued members.",
      trialHelpMissing: "Zeros, missing values and summaries",
      trialHelpMissingBody:
        "Missing values or no positive contributors show —. Summary averages exclude zeros; totals and medians retain known zeros.\nDisplay settings affect the page only, without changing records or exported data.",
      trialHelpOverviewPreview: "Participation counts and average multiples use collected game records only.",
      trialHelpOverviewScope: "Scope and calculation",
      trialHelpRankingPreview: "Participation, average multiples and joining times each use separate rules.",
      trialHelpCounts: "Participation counts",
      trialHelpRankingAverage: "Average multiples and sample counts",
      guildPointForecastWeeks: "Forecast lookback",
      guildPointForecastWeeksHint:
        "Includes this week once points are earned; otherwise ends last week. Estimates are excluded from regression.",
      increaseGuildPointForecastWeeks: "Increase the forecast lookback by 1 week",
      decreaseGuildPointForecastWeeks: "Decrease the forecast lookback by 1 week",
      guildPointPlanningWeeks: "Planning horizon",
      guildPointPlanningOptions: "Forecast settings",
      guildPointPlanningWeeksHint:
        "0 uses the current balance; 1 adds the rest of this week. Later weeks use the next-week forecast at a fixed rate, without counting earned points twice.",
      increaseGuildPointPlanningWeeks: "Increase the planning horizon by 1 week",
      decreaseGuildPointPlanningWeeks: "Decrease the planning horizon by 1 week",
      guildPointPlanningCurrentOnly: "Current points only",
      guildPointWeekCount: "{count} weeks",
      guildPointWeekWithDate: "Week {count} ({date})",
      guildPointPlanningNeedsBalance: "Available Guild Points have not been read yet.",
      guildPointPlanningNeedsForecast:
        "Current balance retained. Projected earnings need known current-week progress and sufficient, consistent history.",
      guildPointPlanningBudgetCurrent: "Planning budget: {total} current points.",
      guildPointPlanningBudgetProjected:
        "Budget: {current} + {remaining} remaining this week + {weeks} later weeks × {weekly} = {total} points.",
      recentGuildPointHistory: "Recent weekly records",
      manualGuildPointWeek: "Week",
      manualGuildPointEarned: "Points earned that week",
      manualGuildPointEarnedForWeek: "Guild Points earned for {week}",
      guildPointHistorySource: "Source",
      saveManualGuildPointHistory: "Save full table",
      manualGuildPointHint:
        "Gray placeholders are estimates. Confirm the warning before editing tracked values. Clear and save to auto-fill an original tracked zero, or restore a nonzero original. Entering 0 keeps a zero value. The current week is read-only.",
      manualGuildPointHistoryEmpty: "There are no completed trial weeks to enter yet.",
      guildPointManualWeekOption: "Starting {week}",
      guildPointSourceTracked: "Game tracked",
      guildPointSourceTrackedEditing: "Correction not saved",
      guildPointSourceManual: "Manual",
      guildPointSourceManualOverride: "Manual override",
      guildPointSourceEstimated: "Auto-filled",
      guildPointSourceEmpty: "Not entered",
      guildPointSourceCurrent: "Tracking now",
      guildPointSourceCurrentEstimated: "Current-week forecast",
      guildPointSourceCurrentPending: "Not started this week",
      guildPointSourceCurrentUnavailable: "Not loaded",
      guildPointSourceNextForecast: "Next-week forecast",
      currentGuildPointWeek: "Current week",
      removeManualGuildPointWeek: "Remove the manual record for {week}",
      manualGuildPointWeekSaved: "Historical Guild Points were saved and missing weeks were recalculated.",
      manualGuildPointWeekTracked: "This week already has a game-tracked record and cannot be overwritten manually.",
      editTrackedGuildPointWeek: "Edit the game-tracked value for {week}",
      editTrackedGuildPointWeekShort: "Edit",
      trackedGuildPointEditWarningTitle: "Override the game-tracked value?",
      trackedGuildPointEditWarningBody:
        "The {points} points for {week} came from game tracking. Continuing lets you enter a manual correction. It affects only this plugin's history, forecast, and construction estimate; it does not change game data.",
      trackedGuildPointEditWarningHint:
        "Clear and save to auto-fill an original tracked zero, or restore a nonzero original.",
      cancelTrackedGuildPointEdit: "Cancel",
      confirmTrackedGuildPointEdit: "Continue editing",
      manualGuildPointWeekInvalid: "Choose a completed trial week and enter a non-negative integer.",
      manualGuildPointWeekRemoved: "The manual record was removed and the missing week is auto-filled again.",
      manualGuildPointHistorySaved: "The historical Guild Point table was saved; blank weeks will remain estimated.",
      constructionEta: "Construction ETA",
      constructionEtaNoPlan: "No plan yet",
      constructionEtaNoPlanHint: "Add a building to estimate completion time.",
      constructionEtaNeedsBalance: "Available Guild Points are unavailable; enter a manual budget.",
      constructionEtaNeedsForecast: "An ETA needs known current-week progress and a valid forecast.",
      constructionEtaHistoryConflict: "Weekly history conflicts with the lifetime total, so the ETA is paused.",
      constructionEtaNoGrowth: "The weekly forecast is zero, so an ETA is unavailable.",
      constructionEtaCovered: "Covered by current points",
      constructionEtaCoveredHint: "The plan can be completed without waiting for more weekly points.",
      constructionEtaWeeks: "About {count} weeks",
      constructionEtaDetail:
        "Need {shortfall} points: count the rest of this week first, then {points} per later week.",
      constructionEtaDetailEstimated:
        "Need {shortfall} points: count this week’s estimated remainder first, then a historical-average {points} per later week.",
      exportGuildPointHistory: "Export weekly CSV",
      resetGuildPointHistory: "Reset weekly records",
      resetGuildPointHistoryConfirm:
        "Reset weekly Guild Point records for this character? Construction plans stay intact, but this cannot be undone.",
      guildPointHistoryReset:
        "Weekly records for this character were reset and a new baseline was created from the current lifetime total.",
      guildPointCsvWeekStart: "Week start",
      guildPointCsvEarned: "Guild Points earned",
      guildPointCsvStatus: "Record status",
      guildPointCsvComplete: "Verified complete week",
      guildPointCsvTracking: "Current week tracking",
      guildPointCsvManual: "Manual",
      guildPointCsvEstimated: "Auto-filled",
      guildPointCsvFileName: "milky-way-idle-guild-point-history.csv",
      plannedSpend: "Planned spend",
      plannedUpgrades: "Planned upgrades",
      affordableUpgrades: "Budget covers",
      remainingPoints: "Budget remaining",
      overBudgetBy: "Over budget",
      constructionPlanScale: "{buildings} buildings · {steps} levels",
      constructionBudgetEmptySummary: "Add a building to see what the budget can cover.",
      constructionNoBudgetSummary: "No budget set · {total} upgrades planned",
      constructionBudgetAllFit: "The budget covers all {total} upgrades.",
      constructionBudgetStopsBefore: "Covers {affordable}/{total}; {building} {from}→{to} needs {count} more",
      buildingCatalog: "Building catalog",
      buildingCatalogHint: "Choose buildings to add; the picker stays open for batch planning.",
      addBuilding: "Add building",
      closeBuildingPicker: "Close building catalog",
      buildingCategoryFilter: "Building categories",
      buildingCategoryAll: "All",
      buildingCategoryCore: "Core",
      buildingCategoryLife: "Life",
      buildingCategoryCombat: "Combat",
      buildingCategoryShrine: "Shrines",
      searchBuildings: "Search buildings",
      currentLevel: "Current level",
      buildingPlanCost: "Plan cost",
      buildingEditor: "Building plan editor",
      selectBuildingPrompt: "Select a building.",
      buildingMaxLevel: "Maximum level",
      notPlanned: "Not planned",
      buildingTileLabel: "{building}, current level {current}, target {target}",
      buildingTileAddLabel: "Add {building}, current level {current}",
      buildingTileDefaultZeroLabel: "Add {building}, current level 0",
      buildingTilePlannedLabel: "Go to {building} in the plan, target level {target}",
      buildingTileMaxLabel: "{building} is at maximum level and cannot be added",
      cancel: "Cancel",
      buildingAddedToPlan: "{building} added to the construction plan.",
      buildingRemovedFromPlan: "{building} removed from the construction plan.",
      buildingTargetUpdated: "{building}'s target is now level {target}.",
      buildingPlansReconciled: "Live levels adjusted {adjusted} plan(s) and removed {removed} completed plan(s).",
      addOneLevel: "Add 1 level",
      addFiveLevels: "Add 5 levels",
      removeBuildingPlan: "Remove from plan",
      movePlanUp: "Move {building} one position earlier",
      movePlanDown: "Move {building} one position later",
      constructionQueue: "Construction plan",
      constructionQueueHint: "Ordered by building; per-level costs are collapsed by default.",
      constructionQueueDragHint: "Reorder: drag, arrow buttons, or Alt + Up/Down",
      dragConstructionPlan: "Reorder {building}",
      constructionQueueEmptyTitle: "Your construction plan is empty",
      constructionQueueEmpty: "Choose Add building to start planning.",
      constructionBudgetCutoff: "Budget cutoff · {count} remaining",
      constructionGroupBudgetCutoff: "Budget reaches level {level} · next level needs {count} more",
      constructionBudgetUnbudgeted: "No budget",
      constructionWithinBudget: "Within budget",
      constructionPartiallyWithinBudget: "Partially covered",
      constructionOverBudget: "Over budget",
      constructionSummary: "{buildings} building(s) · {steps} upgrade(s)",
      constructionPlanRowMeta: "Item {position} · {start}→{target} · {count} upgrade(s)",
      buildingTargetLabel: "Target level for {building}",
      increaseBuildingTarget: "Increase {building}'s target by {count} level(s)",
      expandBuildingSteps: "Expand per-level costs for {building}",
      collapseBuildingSteps: "Collapse per-level costs for {building}",
      removeBuildingFromPlan: "Remove {building} from the construction plan",
      buildingLevelsCoverage: "Levels loaded: {known}/{total}",
      buildingLevelsPartialHint: "{unknown} building level(s) are unavailable and default to level 0.",
      missingBuildingCost: "{building} is missing its level {level} cost and is excluded from the total.",
      moreConstructionActions: "More construction plan actions",
      clearBuildingPlans: "Clear construction plan",
      undoClearBuildingPlans: "Undo clear",
      copyBuildingPlan: "Copy plan",
      exportBuildingCsv: "Export CSV",
      buildingPlanCopied: "Construction plan copied.",
      buildingPlanCopyFailed: "Clipboard access failed. Use CSV export instead.",
      noBuildingMatches: "No buildings match these filters.",
      buildingPlanCleared: "Cleared {count} construction plan item(s).",
      buildingPlanRestored: "Restored {count} construction plan item(s).",
      buildingPlanReordered: "Construction order saved.",
      buildingPlanMovedToPosition: "{building} moved to item {position} of {total}.",
      constructionOrder: "Order",
      fromLevel: "From level",
      toLevel: "To level",
      stepCost: "Step cost",
      cumulativeCost: "Cumulative cost",
      buildingCsvFileName: "milky-way-idle-guild-construction-plan.csv",
      buildingGuildHall: "Guild Hall",
      buildingBuildersHall: "Builders' Hall",
      buildingArchives: "Archives",
      buildingTreasury: "Treasury",
      buildingSkillingEncampment: "Skilling Encampment",
      buildingWorkshop: "Guild Workshop",
      buildingForge: "Guild Forge",
      buildingLogShed: "Guild Log Shed",
      buildingGarden: "Guild Garden",
      buildingDairyBarn: "Guild Dairy Barn",
      buildingKitchen: "Guild Kitchen",
      buildingSewingParlor: "Guild Sewing Parlor",
      buildingBrewery: "Guild Brewery",
      buildingLibrary: "Guild Library",
      buildingLaboratory: "Guild Laboratory",
      buildingMysticalStudy: "Guild Mystical Study",
      buildingCombatEncampment: "Combat Encampment",
      buildingGym: "Guild Gym",
      buildingDojo: "Guild Dojo",
      buildingArcheryRange: "Guild Archery Range",
      buildingArmory: "Guild Armory",
      buildingDiningRoom: "Guild Dining Room",
      buildingObservatory: "Guild Observatory",
      targetCredits: "Target credits",
      increaseTargetCredits: "Increase target credits by 100",
      decreaseTargetCredits: "Decrease target credits by 100",
      marketReference: "Market price reference",
      priceReference: "Price reference",
      refreshEstimate: "Refresh market estimate",
      maxItemUnitPricePrefix: "Exclude items over",
      maxItemUnitPriceSuffix: "M",
      maxItemUnitPricePlaceholder: "No limit",
      maxItemUnitPriceInput: "Exclude conversion items priced over this many million gold",
      increaseMaxItemUnitPrice: "Increase the price limit by 10M",
      decreaseMaxItemUnitPrice: "Decrease the price limit by 10M",
      maxItemUnitPriceHint:
        "Filters by the selected left-one or right-one unit market price; clear the input to disable the filter",
      maxItemUnitPriceInvalid: "Enter an amount above 0M, such as 50",
      maxItemUnitPriceSaveFailed: "The price limit could not be saved; it remains active for this session",
      waitingExchangeRules: "Waiting for game exchange data...",
      guildShrineBatchPlan: "Batch plan by current guild shrine levels",
      setGuildLifeTarget: "Fill Life levels",
      setGuildCombatTarget: "Fill Combat levels",
      guildAutofillAllExcluded: "Every {domain} shrine is excluded from batch fill.",
      guildAutofillDomainExcluded: "No {domain} shrine participates in batch fill. Select one in Settings.",
      selectedUpgradePlanCount: "{count} upgrade plan(s) selected",
      addShrine: "Add shrine",
      clearAll: "Clear all",
      guideEnable: "Enable highlight guide",
      guideDisable: "Disable highlight guide",
      guideReady: "Highlight guide is ready",
      guideReadyHint: "It marks the next step from your plan and live inventory without taking actions.",
      guideNoPlans: "No shrine plan yet",
      guideNoPlansHint: "Add at least one shrine upgrade to start the guide.",
      guideLoading: "Calculating the next step",
      guideLoadingHint: "Waiting for shrine rules, inventory, or market data.",
      guideComplete: "The current plan is complete",
      guideCompleteHint: "Every target shrine has reached its planned level.",
      guideMissingCredits: "Next: fill {count} credit type(s)",
      guideMissingCreditsHint: "Choose in the Guild Shop: {items}",
      guideChooseItem: "Next: select {item}",
      guideChooseItemHint: "This is the current best exchange item for {credit}.",
      guideSetQuantity: "Next: enter {count} batches",
      guideSetQuantityHint: "Uses about {items} {item} and yields {credits} credits.",
      guideSetQuantityLimitHint: "{remaining} batches remain in total; this exchange allows up to {max}.",
      guideQuantityPlanSummary:
        "To complete the current plan, you need “{item}” × {items} and receive “{credit}” × {credits}.",
      guideQuantityCurrentExchange: "Enter {count} batches this time",
      guideTokenQuantityDetail: "Enter {batches} batches to use {items} guild tokens this time",
      guideUseGuildTokens: "Next: use {count} guild tokens",
      guideUseGuildTokensHint: "Guild-token exchange is selected for {credit}.",
      guideUnavailable: "An exchange step is unavailable",
      guideUnavailableHint:
        "No market option is available for this credit. Refresh prices or change its exchange mode.",
      guideBlocked: "Other materials are still missing",
      guideBlockedHint: "Fill these first: {items}",
      guideUpgradeShrine: "Materials are ready; upgrade the shrine",
      guideUpgradeShrineHint: "Upgrade: {shrines}",
      nativeGuildShopTab: "Shop",
      waitingUpgradeRules: "Waiting for shrine upgrade data...",
      author: "Author: 柆雨",
      support: "For help or updates, join QQ group: 437320340",
      fallbackInstaller: "Can't reach Greasy Fork? Use the fallback installer",
      noMarketEstimate: "No market price can be estimated yet",
      noMarketEstimateWithinPriceLimit:
        "No conversion item is available at or below {limit}M; clear the price limit to show all items",
      item: "Item",
      exchange: "Exchange",
      perCredit: "Per credit",
      targetCost: "Target cost",
      tokenExchangeValue: "{token} exchange value",
      noMarketValue: "No market estimate",
      noExchangeRules: "Exchange rules are unavailable. Refresh the game, then reopen the guild shop.",
      readingRules: "Read {count} exchange rule(s); loading the public market snapshot...",
      snapshotLoadFailed: "Market snapshot failed to load: {message}",
      snapshotFallbackUsed:
        "New market data is unavailable. Showing saved data from about {minutes} minute(s) ago; requests are paused to avoid further rate limits.",
      snapshotFallbackNotice: "New market data is unavailable; saved prices are being used.",
      credits: "credits",
      goldPerCredit: "gold / credit",
      singleExchange: "Direct exchange",
      marketCost: "Market cost",
      exchangeRecommendation: "Best exchange recommendation",
      collapseExchangeAdvisor: "Collapse exchange recommendation",
      expandExchangeAdvisor: "Expand exchange recommendation",
      advisorReferenceSelected: "Sell at highest bid ({tax}% tax) · Buy at {reference}",
      advisorReference: "Buy at {reference}",
      chooseItem: "Select an exchange item to compare sell-and-buy-back options.",
      alreadyOptimal: "The current item is already optimal; selling and buying back would not help.",
      sellAndBuyMore: "Selling and buying another item yields <strong>+{count}</strong> {credit}.",
      directMore: "Exchanging directly yields <strong>{count}</strong> more {credit}.",
      sameCredits: "Both options yield the same number of credits.",
      selected: "Current item",
      selectedOptimal: "Current item (best)",
      bestItem: "Best item",
      directExchange: "Direct exchange",
      afterTax: "After tax",
      buybackExchange: "Buy-back exchange",
      purchaseCost: "Purchase cost",
      noSellPrice: "This item has no public buy price, so sell-and-buy-back cannot be estimated.",
      noAffordableReplacement:
        "Selling this quantity yields {gold} after tax, which is not enough to buy an alternative exchange item.",
      trialHistory: "Trial history",
      trialScreenshotGuide: "Image capture help",
      trialScreenshotCopy: "Copy image",
      trialScreenshotDownload: "Download PNG",
      trialScreenshotHelp:
        "Capture full tables in the selected view. Weekly: four skilling projects above two combat projects. By project: only the latest five periods in one row. Player rankings: all lists in one row. Images fit the content width, preserve original icons and omit controls and raw data. Visible fields and anonymity settings are preserved.",
      trialScreenshotReady:
        "Enable “Hide player names” before sharing. If copying is unavailable, the image downloads instead. Your browser controls the save location.",
      trialScreenshotWorking: "Generating full image…",
      trialScreenshotCopied: "Image copied. Ready to paste.",
      trialScreenshotDownloaded: "PNG download started. Check your browser downloads.",
      trialScreenshotFallback: "Clipboard unavailable. PNG download started instead. Check your browser downloads.",
      trialScreenshotTooLarge: "This view is too large for a readable image. Select a single week or player and retry.",
      trialScreenshotIconFailed: "Could not load original icons. Check your connection and retry.",
      trialScreenshotFailed: "Could not generate the image. Retry or select a single week and download PNG.",
      trialSimpleNames: "Simple names",
      trialSimpleNamesHint: "Show plain player names without custom icons or colors for this page session.",
      trialScreenshotMode: "Hide player names",
      trialScreenshotExit: "Show player names",
      trialScreenshotHint:
        "Hides player names in trial history only. JSON exports keep original names. Resets on game reload.",
      trialAnonymousPlayer: "Player {number}",
      trialGuide: "Help",
      trialDisplayNotice:
        "This feature collects and displays data with basic summaries. For further analysis, export your data and share it with an AI, explaining the questions you want answered or the results you would like to see.",
      trialFeedbackNotice:
        "You are also welcome to join QQ group 437320340 and share your AI conversations or results. This helps me understand what you need and plan future development. Thank you for your support!",
      trialDisplaySettings: "Display settings",
      trialMemberColumns: "Member table · Columns",
      trialColumnsCount: "Skilling {skilling}/5 · Combat {combat}/11",
      trialColumnsHint: "Changes apply instantly to all historical member tables. Saved on this device.",
      trialColumnsPresets: "Column presets",
      trialColumnsPreset_compact: "Compact",
      trialColumnsPreset_all: "All",
      trialColumnsPreset_default: "Reset defaults",
      trialColumnsGroup_basic: "Basics · All trials",
      trialColumnsGroup_skilling: "Skilling trials",
      trialColumnsGroup_damageDealt: "Combat · Damage",
      trialColumnsGroup_healingDone: "Combat · Healing",
      trialColumnsGroup_premitigatedDamageTaken: "Combat · Damage taken",
      trialColumnsGroup_levelSummary: "Level summary · Above table",
      trialColumnsGroup_workDoneSummary: "Work summary · Above table",
      trialColumnsCalculations: "Calculations and missing values",
      trialColumnsEmpty: "All columns are hidden. Turn columns back on using the column manager above.",
      trialDisplaySaveFailed: "Settings apply to this page but could not be saved. Reopening may restore defaults.",
      trialOverview: "Trial overview",
      trialKnownCoverage: "{field}: known for {count}/{total} members; summary uses known values only.",
      trialPartialShare:
        "Some metrics are incomplete. Shares use known values; each per-member average uses only members with a known positive value for that metric.",
      trialField_combatShare: "Combat share of total",
      trialField_combatMultiple: "Combat average multiple",
      trialField_damageDealtShare: "Damage share",
      trialField_damageDealtMultiple: "Damage average multiple",
      trialField_healingDoneShare: "Healing share",
      trialField_healingDoneMultiple: "Healing average multiple",
      trialField_premitigatedDamageTakenShare: "Damage taken share",
      trialField_premitigatedDamageTakenMultiple: "Damage taken average multiple",
      trialField_workShare: "Share of total",
      trialLowWork: "Work share in this trial: {share}%, below 0.9%",
      trialSignupLowWork: "Last participation in this project (week {week}): {share}% work share, below 0.9%",
      trialField_workMultiple: "Average multiple",
      trialField_levelSummary: "Level summary",
      trialField_workSummary: "Work summary",
      trialAggregate_level_total: "Total level",
      trialAggregate_level_average: "Average level",
      trialAggregate_level_median: "Median level",
      trialAggregate_workDone_total: "Total work",
      trialAggregate_workDone_average: "Average work",
      trialAggregate_workDone_median: "Median work",
      trialDisplayMode: "History display mode",
      trialByWeek: "By week",
      trialByProject: "By trial",
      trialByPlayer: "By player",
      trialPlayerRankings: "Player rankings",
      trialPlayerOverview: "Trial overview",
      trialOverviewProject: "Trial",
      trialOverviewAverage: "Avg. multiple",
      trialOverviewTotal: "Total multiple",
      trialOverviewAllProjects: "All trials",
      trialOverviewMethod: "Calculation",
      trialOverviewHelp:
        "Uses locally saved game captures, excluding manual records. Each project attended counts once, including zero contributions; 0 means no captured participation. Each per-member average includes only members with a positive value for that metric.\nSkilling uses work divided by that trial’s average. Combat sums the valid damage, healing and damage-taken multiples first. Multiples for each project are then averaged equally across trials.\nTotal multiple sums valid trial multiples. The All trials row sums participation counts and multiples, averaging across valid samples rather than project averages. 1× is the per-person average. Missing values and zero denominators are skipped; no valid multiple shows —.",
      trialRankingJoinedAt: "Guild joining order",
      trialRankingJoinedAtHelp:
        "Current guild members, earliest join first; equal times share a rank. Unknown dates come last without a rank. Dates use local time. Members without trial participation are included.",
      trialRankingRosterEmpty: "Current guild members are not loaded. Open the guild page in the game first.",
      trialRankingDrag: "Drag to reorder {name}",
      trialRankingMoveLeft: "Move {name} left",
      trialRankingMoveRight: "Move {name} right",
      trialRankingOrderHint:
        "Drag the handle below a heading to reorder rankings. You can also use the arrow buttons, or focus a handle and press Alt + Left/Right. Order saves automatically.",
      trialRankingOrderSaveFailed:
        "Order changed but could not be saved; it may reset on reload. Check browser storage and try again.",
      trialRankingParticipations: "Participation count",
      trialRankingAverageTitle: "{scope} · Average multiple",
      trialRankingTotalTitle: "Skilling + combat · Total multiple",
      trialRankingTotalMultiple: "Total multiple",
      trialRankingScope_skilling: "Skilling",
      trialRankingScope_combat: "Combat",
      trialRankingScope_damageDealt: "Damage",
      trialRankingScope_healingDone: "Healing",
      trialRankingScope_premitigatedDamageTaken: "Damage taken",
      trialRankingScope_all: "Skilling + combat",
      trialRankingRank: "Rank",
      trialRankingCount: "Count",
      trialRankingMultiple: "Avg. multiple",
      trialRankingSamples: "Samples",
      trialRankingMethod: "How rankings are calculated",
      trialRankingCountHelp:
        "Only records captured by the plugin from the game count; manual transcripts are excluded from rankings. Each skilling or combat project attended counts once, including zero contributions. Uncaptured projects are excluded. Equal values share a rank.",
      trialRankingAverageHelp:
        "The separate damage, healing and pre-mitigation damage taken rankings use only their own metric multiples, excluding missing values and zero denominators independently.\nSkilling and combat each average weekly multiples over eligible guild weeks. Membership must begin before the week starts. Confirmed absence counts as 0, and each category adds at most one denominator per week. Each per-member baseline includes only members with a positive value for that metric.\nSkilling uses work; combat sums the valid damage, healing and damage-taken multiples for each project, averages the valid projects within each week, then averages across weeks.\nAbsence requires a fully captured category and membership evidence from join times or attendance. Unknown membership, incomplete captures and unavailable multiples are not treated as zero. Only captured completed weeks are covered; manual records are entirely excluded.\nCombined score = skilling average + combat average, without dividing by 2; a sole valid category retains its average.\nSamples count captured attendance, at most once per category per week. Attended weeks count even with zero or unknown metrics; absences do not. Combined samples sum both categories. Samples differ from the averaging denominator: confirmed absences still enter the average as zero.",
      trialPlayerFind: "Choose a player",
      trialPlayerSwitch: "Current player: {name} · Change player",
      trialPlayerSearchLabel: "Search historical players",
      trialPlayerSearchPlaceholder: "Enter all or part of a player name",
      trialPlayerSearchButton: "Search",
      trialPlayerSearchClear: "Clear",
      trialPlayerSearchCount: "Showing {count} of {total} players",
      trialPlayerSearchEmpty: "No matching players. Try another name or clear the search.",
      trialChoosePlayer: "Player",
      trialSelectPlayerPrompt: "Select a player to view trial history",
      trialNoNamedPlayers: "No recorded player names yet",
      trialChooseWeek: "Week",
      trialChooseProject: "Trial",
      trialUnknownWeek: "Unknown week",
      trialUnrecordedProject: "Unrecorded trial",
      trialMissingRecord: "No record",
      trialScrollLeft: "Scroll left",
      trialScrollRight: "Scroll right",
      trialNewer: "Newer weeks",
      trialOlder: "Older weeks",
      trialDataTransfer: "Trial data import and export",
      trialImport: "Import JSON",
      trialImportFile: "Choose a trial history JSON file",
      trialImportHint:
        "Import exported history or manually transcribed records (up to 10 MB). Preview before saving. Missing dates and weeks can be filled in; duplicates and statistics conflicts are skipped.",
      trialImportReading: "Reading file…",
      trialImportPreview: "Import preview",
      trialImportSummary: "{added} new · {dated} dates filled · {duplicates} duplicates · {conflicts} conflicts",
      trialImportStatus_new: "New",
      trialImportStatus_dated: "Fill in date and week",
      trialImportStatus_duplicate: "Duplicate, skipped",
      trialImportStatus_conflict: "Different content; keep existing",
      trialImportMemberCount: "{count} members",
      trialImportConfirm: "Import {count} records",
      trialImportCancel: "Cancel",
      trialImportTooLarge: "Choose a JSON file no larger than 10 MB.",
      trialImportInvalidJson: "Invalid JSON or unsafe fields. Check the file contents.",
      trialImportInvalidFile:
        "Unsupported format. Choose an exported history or manual transcript file with 1–1,000 records.",
      trialImportInvalidRecord:
        "Record {index} is invalid. Check its date, members, trial identifier and non-negative numeric statistics. Nothing was imported.",
      trialImportDuplicateKey:
        "Record {index} repeats an identifier in this file. Remove the duplicate first. Nothing was imported.",
      trialImportReadFailed: "The file could not be read. Choose it again.",
      trialImportComplete:
        "Imported {added}; filled {dated} dates; skipped {duplicates} duplicates and {conflicts} conflicts.",
      trialImportSaveFailed:
        "Saving failed. Changes from this attempt were rolled back. Check browser storage space and retry.",
      trialImportPartial:
        "Saving failed; {added} new records and {dated} date updates remain saved. Retrying skips saved records.",
      trialUnknownDate: "Date unspecified",
      trialUnknownGuild: "Guild unspecified",
      trialManualSource: "Manual transcript",
      trialAutomaticSource: "Game capture",
      trialHistoryHint:
        "After a trial ends, open the game’s Stats to archive every completed trial in its response. Records stay in this browser, separated by server and character. Past results can also be imported from manual transcripts.",
      trialHistoryEmpty: "No records yet. Import a history file or open the game’s Stats after a trial ends.",
      trialSavedCount: "{count} records",
      trialSaveFailed:
        "Some records could not be saved. Export a backup before checking browser storage space; unsaved data is still available on this page.",
      trialLoadFailed:
        "Some local records could not be read. Their stored data was preserved; only readable records are shown.",
      trialExport: "Export all JSON",
      trialSkilling: "Skilling trial",
      trialCombat: "Combat trial",
      trialSummary: "{count} members · {points} points · Tier {tier} · Next tier {progress}",
      trialStatsTable: "Member trial statistics",
      trialMember: "Member",
      trialNameUnavailable: "Name unavailable",
      trialPlayerBack: "Back to history",
      trialPlayerHistory: "Trial history",
      trialPlayerProfile: "Player profile",
      trialProfileRefresh: "Refresh profile",
      trialProfileLoading: "Loading profile…",
      trialProfileTimeout: "Profile request timed out. Use Refresh profile to try again.",
      trialProfileMismatch: "The returned character ID does not match this historical player.",
      trialPlayerEmpty: "No trial records for this player.",
      trialProfileGuild: "Guild",
      trialProfileTotalLevel: "Total level",
      trialProfileCombatLevel: "Combat level",
      trialProfileJoinedAt: "Joined guild",
      trialProfileJoinedAtUnknown: "Unknown",
      trialProfileJoinedAtHelp:
        "Time of joining the current guild, shown in your local time zone. Unknown if the current roster has no valid joining time.",
      trialProfileSkills: "Skill levels",
      trialProfileEquipment: "Equipment",
      trialSlot_back: "Back",
      trialSlot_head: "Head",
      trialSlot_trinket: "Trinket",
      trialSlot_neck: "Neck",
      trialSlot_main_hand: "Main hand",
      trialSlot_body: "Body",
      trialSlot_off_hand: "Off hand",
      trialSlot_earrings: "Earrings",
      trialSlot_hands: "Hands",
      trialSlot_legs: "Legs",
      trialSlot_pouch: "Pouch",
      trialSlot_ring: "Ring",
      trialSlot_feet: "Feet",
      trialSlot_charm: "Charm",
      trialSlot_milking_tool: "Milking",
      trialSlot_foraging_tool: "Foraging",
      trialSlot_woodcutting_tool: "Woodcutting",
      trialSlot_cheesesmithing_tool: "Cheesesmithing",
      trialSlot_crafting_tool: "Crafting",
      trialSlot_tailoring_tool: "Tailoring",
      trialSlot_cooking_tool: "Cooking",
      trialSlot_brewing_tool: "Brewing",
      trialSlot_alchemy_tool: "Alchemy",
      trialSlot_enhancing_tool: "Enhancing",
      trialProfileAbilities: "Abilities",
      trialProfileActivity: "Current activity",
      trialProfilePresence: "Online status",
      trialProfileObservation: "Activity and online status reflect the last profile read.",
      trialActivityUnknown: "Not shared or unknown",
      trialActivity_combat: "Combat",
      trialActivity_labyrinth: "Labyrinth",
      trialActivity_special: "Special activity",
      trialPresence_online: "Online",
      trialPresence_offline: "Offline",
      trialPresence_hidden: "Hidden",
      trialPresence_unknown: "Unknown",
      trialProfileHouse: "House",
      trialProfileHouseLevel: "House level: {level}",
      trialProfileRaw: "Full profile data",
      trialProfileTooltipUnavailable: "Detailed data is currently unavailable",
      trialProfile_totalTaskPoints: "Task points",
      trialProfile_labyrinthPoints: "Labyrinth points",
      trialProfile_labyrinthHighestFloor: "Highest labyrinth floor",
      trialProfile_collectionPoints: "Collection points",
      trialProfile_bestiaryPoints: "Bestiary points",
      trialProfile_famePoints: "Fame points",
      trialSkill_stamina: "Stamina",
      trialSkill_intelligence: "Intelligence",
      trialSkill_attack: "Attack",
      trialSkill_melee: "Melee",
      trialSkill_defense: "Defense",
      trialSkill_ranged: "Ranged",
      trialSkill_magic: "Magic",
      trialMemberAbsent: "Has left the guild",
      trialOpenProfile: "View {name}'s trial history",
      trialProfileUnavailable:
        "Cannot open the player profile. Check the game connection and refresh the page before trying again.",
      trialSortAscending: "Sort {field} ascending",
      trialSortDescending: "Sort {field} descending",
      trialField_level: "Level",
      trialField_workDone: "Work done",
      trialField_damageDealt: "Damage dealt",
      trialField_healingDone: "Healing done",
      trialField_premitigatedDamageTaken: "Damage taken before mitigation",
      trialName_milking: "Milking",
      trialName_badger: "Trial Badger",
      trialName_chameleon: "Trial Chameleon",
      trialName_jellyfish: "Trial Jellyfish",
      trialName_hedgehog: "Trial Hedgehog",
      trialName_swarm: "Trial Swarm",
      trialName_foraging: "Foraging",
      trialName_woodcutting: "Woodcutting",
      trialName_cheesesmithing: "Cheesesmithing",
      trialName_crafting: "Crafting",
      trialName_tailoring: "Tailoring",
      trialName_cooking: "Cooking",
      trialName_brewing: "Brewing",
      trialName_alchemy: "Alchemy",
      trialName_enhancing: "Enhancing",
      sidebarCredit: "Guild"
    }
  };

  const ITEM_NAMES = {
    "zh-CN": {
      "/items/guild_token": "公會代幣",
      "/items/green_guild_credit": "綠色公會信用點",
      "/items/brown_guild_credit": "棕色公會信用點",
      "/items/white_guild_credit": "白色公會信用點",
      "/items/blue_guild_credit": "藍色公會信用點",
      "/items/purple_guild_credit": "紫色公會信用點",
      "/items/red_guild_credit": "紅色公會信用點",
      "/items/silver_guild_credit": "銀色公會信用點",
      "/items/gold_guild_credit": "金色公會信用點"
    },
    en: {
      "/items/guild_token": "Guild Token",
      "/items/green_guild_credit": "Green Guild Credit",
      "/items/brown_guild_credit": "Brown Guild Credit",
      "/items/white_guild_credit": "White Guild Credit",
      "/items/blue_guild_credit": "Blue Guild Credit",
      "/items/purple_guild_credit": "Purple Guild Credit",
      "/items/red_guild_credit": "Red Guild Credit",
      "/items/silver_guild_credit": "Silver Guild Credit",
      "/items/gold_guild_credit": "Gold Guild Credit"
    }
  };

  function supportedLocale(locale) {
    if (typeof locale !== "string") return null;
    const candidate = locale.trim().toLowerCase().replaceAll("_", "-");
    if (/^zh(?:-|$)/.test(candidate)) return "zh-CN";
    if (/^en(?:-|$)/.test(candidate)) return "en";
    return null;
  }

  function resolveLocaleCandidates(candidates, fallback = "zh-CN") {
    for (const candidate of Array.isArray(candidates) ? candidates : [candidates]) {
      const locale = supportedLocale(candidate);
      if (locale) return locale;
    }
    return supportedLocale(fallback) || "zh-CN";
  }

  function normalizeLocale(locale) {
    return supportedLocale(locale) || "en";
  }

  function interpolate(template, values) {
    return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) =>
      values && values[key] !== undefined ? String(values[key]) : `{${key}}`
    );
  }

  function createLocalizer(locale) {
    const normalizedLocale = normalizeLocale(locale);
    const strings = STRINGS[normalizedLocale];
    function t(key, values) {
      return interpolate(strings[key] || STRINGS.en[key] || key, values);
    }
    function number(value, digits) {
      if (value === null || value === undefined || !Number.isFinite(value)) return "-";
      return new Intl.NumberFormat(normalizedLocale, {
        maximumFractionDigits: digits === undefined ? 0 : digits
      }).format(value);
    }
    function quantity(key, count) {
      const formatted = number(count);
      if (normalizedLocale === "zh-CN") return t(key, { count: formatted });
      const unit =
        key === "creditQuantity"
          ? Number(count) === 1
            ? "credit"
            : "credits"
          : Number(count) === 1
            ? "item"
            : "items";
      return t(key, { count: formatted, unit });
    }
    function itemName(itemHrid) {
      return ITEM_NAMES[normalizedLocale][itemHrid] || "";
    }
    return { locale: normalizedLocale, t, number, quantity, itemName };
  }

  return { STRINGS, ITEM_NAMES, supportedLocale, resolveLocaleCandidates, normalizeLocale, createLocalizer };
});


// SOURCE: src/core.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildCreditCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function positiveInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  const DEFAULT_GUILD_TOKEN_BUDGET_SNAP_PERCENTAGES = [20, 40, 50, 60, 80, 100];

  function guildTokenBudgetPercentage(value, maximum) {
    const max = Math.max(0, Math.floor(Number(maximum) || 0));
    if (!max) return 0;
    const clamped = Math.min(max, Math.max(0, Math.floor(Number(value) || 0)));
    return Math.round((clamped / max) * 100);
  }

  function snapGuildTokenBudget(rawValue, maximum, options = {}) {
    const max = Math.max(0, Math.floor(Number(maximum) || 0));
    const value = Math.min(max, Math.max(0, Math.floor(Number(rawValue) || 0)));
    if (!max) return { value: 0, percentage: 0, snappedTo: null };
    const snapPercentages = (
      Array.isArray(options.snapPercentages) ? options.snapPercentages : DEFAULT_GUILD_TOKEN_BUDGET_SNAP_PERCENTAGES
    )
      .map(Number)
      .filter((percentage) => Number.isFinite(percentage) && percentage > 0 && percentage <= 100);
    const threshold = Math.max(0, Number(options.thresholdPercentage ?? 2.5) || 0);
    const rawPercentage = (value / max) * 100;
    const snappedTo = snapPercentages.reduce((nearest, percentage) => {
      if (nearest === null) return percentage;
      return Math.abs(percentage - rawPercentage) < Math.abs(nearest - rawPercentage) ? percentage : nearest;
    }, null);
    if (snappedTo === null || Math.abs(snappedTo - rawPercentage) > threshold) {
      return { value, percentage: guildTokenBudgetPercentage(value, max), snappedTo: null };
    }
    const snappedValue = Math.min(max, Math.max(0, Math.round((max * snappedTo) / 100)));
    return { value: snappedValue, percentage: guildTokenBudgetPercentage(snappedValue, max), snappedTo };
  }

  function normalizeAsks(orderBook) {
    if (!orderBook || !Array.isArray(orderBook.asks)) return [];
    return orderBook.asks
      .map((ask) => ({ price: Number(ask.price), quantity: Number(ask.quantity) }))
      .filter(
        (ask) => Number.isFinite(ask.price) && ask.price >= 0 && Number.isSafeInteger(ask.quantity) && ask.quantity > 0
      )
      .sort((left, right) => left.price - right.price);
  }

  function quoteAsks(orderBook, requestedQuantity) {
    const quantity = positiveInteger(requestedQuantity);
    if (!quantity)
      return { status: "invalid_quantity", requestedQuantity, availableQuantity: 0, cost: null, fills: [] };

    let remaining = quantity;
    let cost = 0;
    let availableQuantity = 0;
    const fills = [];

    for (const ask of normalizeAsks(orderBook)) {
      availableQuantity += ask.quantity;
      if (remaining === 0) continue;
      const take = Math.min(remaining, ask.quantity);
      cost += take * ask.price;
      fills.push({ price: ask.price, quantity: take });
      remaining -= take;
    }

    if (remaining > 0) {
      return { status: "insufficient_depth", requestedQuantity: quantity, availableQuantity, cost: null, fills };
    }
    return { status: "ok", requestedQuantity: quantity, availableQuantity, cost, fills };
  }

  function evaluateConversion(conversion, orderBook, targetCredits) {
    const target = positiveInteger(targetCredits);
    const itemCount = positiveInteger(conversion && conversion.itemCount);
    const creditCount = positiveInteger(conversion && conversion.creditCount);
    if (!target || !itemCount || !creditCount) {
      return { status: "invalid_conversion", conversion, targetCredits };
    }

    const batches = Math.ceil(target / creditCount);
    const requiredItems = batches * itemCount;
    const actualCredits = batches * creditCount;
    const quote = quoteAsks(orderBook, requiredItems);
    const base = {
      status: quote.status,
      itemHrid: conversion.itemHrid,
      itemName: conversion.itemName || conversion.itemHrid,
      creditItemHrid: conversion.creditItemHrid,
      itemCount,
      creditCount,
      targetCredits: target,
      batches,
      requiredItems,
      actualCredits,
      availableQuantity: quote.availableQuantity,
      fills: quote.fills,
      buyerFee: 0
    };
    if (quote.status !== "ok") return { ...base, cost: null, costPerCredit: null };
    return { ...base, cost: quote.cost, costPerCredit: quote.cost / actualCredits };
  }

  function rankConversions(conversions, orderBooks, targetCredits) {
    return conversions
      .map((conversion) => evaluateConversion(conversion, orderBooks[conversion.itemHrid], targetCredits))
      .sort((left, right) => {
        if (left.status === "ok" && right.status !== "ok") return -1;
        if (right.status === "ok" && left.status !== "ok") return 1;
        if (left.status !== "ok" || right.status !== "ok") return left.itemName.localeCompare(right.itemName, "zh-CN");
        return (
          left.costPerCredit - right.costPerCredit ||
          left.cost - right.cost ||
          left.itemName.localeCompare(right.itemName, "zh-CN")
        );
      });
  }

  function rankGuildTokenCreditValues(exchangeRules, rankedCredits) {
    const rankings = rankedCredits && typeof rankedCredits === "object" ? rankedCredits : {};
    return (Array.isArray(exchangeRules) ? exchangeRules : []).map((rule) => {
      const guildTokenCount = positiveInteger(rule && rule.guildTokenCount);
      const creditCount = positiveInteger(rule && rule.creditCount);
      const creditItemHrid = rule && rule.creditItemHrid;
      if (!guildTokenCount || !creditCount || !creditItemHrid) {
        return { status: "invalid_rule", rule };
      }
      const best = (Array.isArray(rankings[creditItemHrid]) ? rankings[creditItemHrid] : []).find(
        (result) => result && result.status === "ok" && Number.isFinite(result.costPerCredit)
      );
      if (!best) {
        return { status: "unpriced", guildTokenCount, creditCount, creditItemHrid };
      }
      return {
        status: "ok",
        guildTokenCount,
        creditCount,
        creditItemHrid,
        // A token's value is based on the exchange rule's credit quantity, not
        // the minimum purchasable batch. This avoids overstating sparse credits.
        goldValue: best.costPerCredit * creditCount,
        goldValuePerToken: (best.costPerCredit * creditCount) / guildTokenCount,
        bestItemHrid: best.itemHrid,
        bestItemName: best.itemName
      };
    });
  }

  function evaluateBudgetConversion(conversion, buyPrice, budget) {
    const itemCount = positiveInteger(conversion && conversion.itemCount);
    const creditCount = positiveInteger(conversion && conversion.creditCount);
    const price = Number(buyPrice);
    const availableBudget = Number(budget);
    if (
      !itemCount ||
      !creditCount ||
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isFinite(availableBudget) ||
      availableBudget < 0
    ) {
      return { status: "invalid_conversion", conversion, buyPrice, budget };
    }

    const batchCost = itemCount * price;
    const batches = Math.floor(availableBudget / batchCost);
    const requiredItems = batches * itemCount;
    const actualCredits = batches * creditCount;
    const cost = requiredItems * price;
    return {
      status: actualCredits > 0 ? "ok" : "unaffordable",
      itemHrid: conversion.itemHrid,
      itemName: conversion.itemName || conversion.itemHrid,
      creditItemHrid: conversion.creditItemHrid,
      itemCount,
      creditCount,
      buyPrice: price,
      budget: availableBudget,
      batches,
      requiredItems,
      actualCredits,
      cost,
      remainingBudget: availableBudget - cost,
      costPerCredit: batchCost / creditCount,
      buyerFee: 0
    };
  }

  function bestConversionForBudget(conversions, buyPrices, budget) {
    const candidates = (Array.isArray(conversions) ? conversions : [])
      .map((conversion) => evaluateBudgetConversion(conversion, buyPrices && buyPrices[conversion.itemHrid], budget))
      .filter((result) => result.status === "ok")
      .sort(
        (left, right) =>
          right.actualCredits - left.actualCredits ||
          left.costPerCredit - right.costPerCredit ||
          left.cost - right.cost ||
          left.itemName.localeCompare(right.itemName, "zh-CN")
      );
    return candidates[0] || null;
  }

  function estimateSaleReplacement(options) {
    const selectedConversion = options && options.selectedConversion;
    const batches = positiveInteger(options && options.batches);
    const selectedItemCount = positiveInteger(selectedConversion && selectedConversion.itemCount);
    const selectedCreditCount = positiveInteger(selectedConversion && selectedConversion.creditCount);
    if (!batches || !selectedItemCount || !selectedCreditCount) {
      return { status: "invalid_selection", options };
    }

    const directCredits = batches * selectedCreditCount;
    const sale = calculateSaleProceeds(
      batches * selectedItemCount,
      options && options.sellPrice,
      options && options.sellerTaxRate
    );
    if (sale.status !== "ok") return { status: sale.status, directCredits, sale };

    const best = bestConversionForBudget(options && options.conversions, options && options.buyPrices, sale.net);
    if (!best) return { status: "no_affordable_conversion", directCredits, sale, best: null };
    if (best.itemHrid === selectedConversion.itemHrid) {
      return { status: "already_optimal", directCredits, sale, best, creditDifference: 0 };
    }

    return {
      status: "ok",
      directCredits,
      sale,
      best,
      creditDifference: best.actualCredits - directCredits
    };
  }

  function calculateSaleProceeds(quantity, sellPrice, sellerTaxRate) {
    const itemQuantity = positiveInteger(quantity);
    const price = Number(sellPrice);
    const taxRate = Number(sellerTaxRate);
    if (
      !itemQuantity ||
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isFinite(taxRate) ||
      taxRate < 0 ||
      taxRate >= 1
    ) {
      return { status: "invalid_sale", quantity, sellPrice, sellerTaxRate, gross: null, tax: null, net: null };
    }
    const gross = itemQuantity * price;
    const tax = Math.floor(gross * taxRate);
    return {
      status: "ok",
      quantity: itemQuantity,
      sellPrice: price,
      sellerTaxRate: taxRate,
      gross,
      tax,
      net: gross - tax
    };
  }

  function snapshotMarketPrice(snapshot, itemHrid, enhancementLevel, field) {
    const level = Number(enhancementLevel);
    if (!itemHrid || !Number.isSafeInteger(level) || level < 0 || (field !== "a" && field !== "b")) return null;
    const entry =
      snapshot && snapshot.marketData && snapshot.marketData[itemHrid] && snapshot.marketData[itemHrid][String(level)];
    const price = Number(entry && entry[field]);
    return Number.isFinite(price) && price > 0 ? price : null;
  }

  function formatCompactCost(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "-";
    const rounded = Math.round(number);
    if (rounded < 10000) return String(rounded);
    const thousands = Math.round(rounded / 1000);
    if (thousands < 10000) return `${thousands}k`;
    return `${Math.round(rounded / 1000000)}m`;
  }

  function compareVersions(currentVersion, latestVersion) {
    const parse = (value) => (String(value || "").match(/\d+/g) || []).map(Number);
    const current = parse(currentVersion);
    const latest = parse(latestVersion);
    const length = Math.max(current.length, latest.length);
    for (let index = 0; index < length; index += 1) {
      const difference = (current[index] || 0) - (latest[index] || 0);
      if (difference !== 0) return difference;
    }
    return 0;
  }

  function selectGuildShrineAutofillScope(options = {}) {
    const entries = Array.isArray(options.entries) ? options.entries : [];
    const plans = Array.isArray(options.plans) ? options.plans : [];
    const domain = options.domain === "combat" ? "combat" : options.domain === "life" ? "life" : null;
    if (!domain) return { eligibleEntries: [], preservedPlans: plans.slice() };

    const excludedSource = options.excludedGuildBuffHrids;
    const excludedGuildBuffHrids = new Set(
      excludedSource && typeof excludedSource !== "string" && typeof excludedSource[Symbol.iterator] === "function"
        ? excludedSource
        : []
    );
    const entriesByHrid = new Map(
      entries.filter((entry) => entry && typeof entry.hrid === "string").map((entry) => [entry.hrid, entry])
    );
    const entryDomain = (entry) => (entry && entry.detail && entry.detail.isCombat === true ? "combat" : "life");
    const eligibleEntries = entries.filter(
      (entry) =>
        entry &&
        typeof entry.hrid === "string" &&
        entryDomain(entry) === domain &&
        !excludedGuildBuffHrids.has(entry.hrid)
    );
    const preservedPlans = plans.filter((plan) => {
      const guildBuffHrid = plan && plan.guildBuffHrid;
      const entry = entriesByHrid.get(guildBuffHrid);
      return !entry || entryDomain(entry) !== domain || excludedGuildBuffHrids.has(guildBuffHrid);
    });
    return { eligibleEntries, preservedPlans };
  }

  function aggregateGuildBuffLevelCosts(levelCosts, startLevel, targetLevel) {
    const start = Number(startLevel);
    const target = Number(targetLevel);
    const costs = Array.isArray(levelCosts)
      ? levelCosts
      : levelCosts && typeof levelCosts === "object"
        ? levelCosts
        : null;
    if (!costs || !Number.isSafeInteger(start) || !Number.isSafeInteger(target) || start < 0 || target <= start) {
      return { status: "invalid_range", startLevel, targetLevel, totals: [] };
    }

    const maxLevel = Array.isArray(costs)
      ? costs.length - 1
      : Math.max(...Object.keys(costs).map(Number).filter(Number.isSafeInteger));
    if (!Number.isSafeInteger(maxLevel) || target > maxLevel) {
      return { status: "invalid_range", startLevel: start, targetLevel: target, maxLevel, totals: [] };
    }

    const totals = new Map();
    const add = (itemHrid, count) => {
      const quantity = Number(count);
      if (!itemHrid || !Number.isFinite(quantity) || quantity <= 0) return;
      totals.set(itemHrid, (totals.get(itemHrid) || 0) + quantity);
    };

    for (let level = start + 1; level <= target; level += 1) {
      const cost = costs[level];
      if (!cost || typeof cost !== "object") {
        return {
          status: "missing_cost",
          startLevel: start,
          targetLevel: target,
          maxLevel,
          missingLevel: level,
          totals: []
        };
      }
      add("/items/guild_token", cost.guildTokenCost);
      for (const creditCost of cost.creditCosts || []) add(creditCost.itemHrid, creditCost.count);
    }

    return {
      status: "ok",
      startLevel: start,
      targetLevel: target,
      maxLevel,
      totals: [...totals.entries()]
        .map(([itemHrid, count]) => ({ itemHrid, count }))
        .sort((left, right) => left.itemHrid.localeCompare(right.itemHrid))
    };
  }

  function aggregateGuildBuffPlans(plans) {
    if (!Array.isArray(plans) || plans.length === 0) return { status: "invalid_plans", plans: [], totals: [] };

    const totals = new Map();
    const results = [];
    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index];
      const result = aggregateGuildBuffLevelCosts(
        plan && plan.levelCosts,
        plan && plan.startLevel,
        plan && plan.targetLevel
      );
      if (result.status !== "ok")
        return { status: "invalid_plan", planIndex: index, result, plans: results, totals: [] };
      results.push({ ...result, id: plan && plan.id, guildBuffHrid: plan && plan.guildBuffHrid });
      for (const item of result.totals) totals.set(item.itemHrid, (totals.get(item.itemHrid) || 0) + item.count);
    }

    return {
      status: "ok",
      plans: results,
      totals: [...totals.entries()]
        .map(([itemHrid, count]) => ({ itemHrid, count }))
        .sort((left, right) => left.itemHrid.localeCompare(right.itemHrid))
    };
  }

  function aggregateGuildBuildingLevelCosts(levelCosts, startLevel, targetLevel) {
    const start = Number(startLevel);
    const target = Number(targetLevel);
    const costs = Array.isArray(levelCosts)
      ? levelCosts
      : levelCosts && typeof levelCosts === "object"
        ? levelCosts
        : null;
    if (!costs || !Number.isSafeInteger(start) || !Number.isSafeInteger(target) || start < 0 || target <= start) {
      return { status: "invalid_range", startLevel, targetLevel, totalCost: 0, steps: [] };
    }
    const maxLevel = Array.isArray(costs)
      ? costs.length - 1
      : Math.max(...Object.keys(costs).map(Number).filter(Number.isSafeInteger));
    if (!Number.isSafeInteger(maxLevel) || target > maxLevel) {
      return { status: "invalid_range", startLevel: start, targetLevel: target, maxLevel, totalCost: 0, steps: [] };
    }
    const steps = [];
    let totalCost = 0;
    for (let level = start + 1; level <= target; level += 1) {
      const record = costs[level];
      const rawCost = record && (record.guildPointCost ?? record.guildPoints ?? record.cost);
      const cost = Number(rawCost);
      if (rawCost === null || rawCost === undefined || !Number.isFinite(cost) || cost < 0) {
        return {
          status: "missing_cost",
          startLevel: start,
          targetLevel: target,
          maxLevel,
          missingLevel: level,
          totalCost: 0,
          steps: []
        };
      }
      totalCost += cost;
      steps.push({ fromLevel: level - 1, toLevel: level, cost });
    }
    return { status: "ok", startLevel: start, targetLevel: target, maxLevel, totalCost, steps };
  }

  function buildGuildConstructionPlan(plans, availableGuildPoints) {
    const inputPlans = Array.isArray(plans) ? plans : [];
    const hasBudget =
      availableGuildPoints !== null && availableGuildPoints !== undefined && availableGuildPoints !== "";
    const budgetNumber = Number(availableGuildPoints);
    if (hasBudget && (!Number.isFinite(budgetNumber) || budgetNumber < 0)) {
      return { status: "invalid_budget", plans: [], steps: [], totalCost: 0, availableGuildPoints };
    }
    const budget = hasBudget ? Math.floor(budgetNumber) : null;
    const results = [];
    const steps = [];
    let cumulativeCost = 0;
    for (let planIndex = 0; planIndex < inputPlans.length; planIndex += 1) {
      const plan = inputPlans[planIndex] || {};
      const result = aggregateGuildBuildingLevelCosts(plan.levelCosts, plan.startLevel, plan.targetLevel);
      if (result.status !== "ok") {
        return {
          status: "invalid_plan",
          planIndex,
          result,
          plans: results,
          steps: [],
          totalCost: 0,
          availableGuildPoints: budget
        };
      }
      const annotatedSteps = [];
      let affordableStepCount = 0;
      let nextStepShortfall = null;
      for (const step of result.steps) {
        cumulativeCost += step.cost;
        const fitsBudget = budget === null ? null : cumulativeCost <= budget;
        const annotatedStep = {
          ...step,
          id: plan.id,
          buildingHrid: plan.buildingHrid,
          globalIndex: steps.length,
          cumulativeCost,
          fitsBudget,
          remainingGuildPoints: budget === null ? null : budget - cumulativeCost
        };
        steps.push(annotatedStep);
        annotatedSteps.push(annotatedStep);
        if (fitsBudget !== false) affordableStepCount += 1;
        else if (nextStepShortfall === null) nextStepShortfall = cumulativeCost - budget;
      }
      const budgetState =
        budget === null
          ? "unbudgeted"
          : affordableStepCount === annotatedSteps.length
            ? "within"
            : affordableStepCount > 0
              ? "partial"
              : "outside";
      results.push({
        ...result,
        id: plan.id,
        buildingHrid: plan.buildingHrid,
        steps: annotatedSteps,
        budgetState,
        affordableStepCount,
        affordableTargetLevel: result.startLevel + affordableStepCount,
        nextStepShortfall
      });
    }
    const firstOverBudgetIndex = budget === null ? -1 : steps.findIndex((step) => !step.fitsBudget);
    return {
      status: "ok",
      plans: results,
      steps,
      totalCost: cumulativeCost,
      availableGuildPoints: budget,
      remainingGuildPoints: budget === null ? null : budget - cumulativeCost,
      overBudget: budget === null ? false : cumulativeCost > budget,
      affordableStepCount:
        budget === null ? steps.length : firstOverBudgetIndex < 0 ? steps.length : firstOverBudgetIndex,
      firstOverBudgetIndex
    };
  }

  const GUILD_POINT_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const DEFAULT_GUILD_POINT_FORECAST_WEEKS = 6;
  const MIN_GUILD_POINT_FORECAST_WEEKS = 2;
  const MAX_GUILD_POINT_FORECAST_WEEKS = 12;

  function normalizeGuildPointForecastWeeks(value) {
    const weeks = Number(value);
    return Number.isSafeInteger(weeks) &&
      weeks >= MIN_GUILD_POINT_FORECAST_WEEKS &&
      weeks <= MAX_GUILD_POINT_FORECAST_WEEKS
      ? weeks
      : DEFAULT_GUILD_POINT_FORECAST_WEEKS;
  }

  function guildPointObservation(value) {
    const lifetimePoints = Number(value && value.lifetimePoints);
    const availablePoints = Number(value && value.availablePoints);
    const observedAt = Number(value && value.observedAt);
    const parsedWeekStart = Date.parse(value && value.weekStartAt);
    const numericWeekStart = Number(value && value.weekStartAt);
    const weekStartAt =
      Number.isSafeInteger(numericWeekStart) && numericWeekStart > 0 ? numericWeekStart : parsedWeekStart;
    if (
      !Number.isSafeInteger(lifetimePoints) ||
      lifetimePoints < 0 ||
      !Number.isSafeInteger(availablePoints) ||
      availablePoints < 0 ||
      !Number.isSafeInteger(observedAt) ||
      observedAt <= 0
    )
      return null;
    return {
      guildId: String((value && value.guildId) || ""),
      lifetimePoints,
      availablePoints,
      weekStartAt: Number.isSafeInteger(weekStartAt) && weekStartAt > 0 ? weekStartAt : null,
      observedAt
    };
  }

  function normalizeGuildPointWeeks(value) {
    const byWeek = new Map();
    for (const record of Array.isArray(value) ? value : []) {
      const weekStartAt = Number(record && record.weekStartAt);
      const earnedPoints = Number(record && record.earnedPoints);
      const observedAt = Number(record && record.observedAt);
      if (
        !Number.isSafeInteger(weekStartAt) ||
        weekStartAt <= 0 ||
        !Number.isSafeInteger(earnedPoints) ||
        earnedPoints < 0
      )
        continue;
      const previous = byWeek.get(weekStartAt);
      byWeek.set(weekStartAt, {
        weekStartAt,
        earnedPoints: previous ? previous.earnedPoints + earnedPoints : earnedPoints,
        complete: Boolean((previous && previous.complete) || (record && record.complete)),
        coverage:
          record?.coverage === "verified" && (!previous || previous.coverage === "verified") ? "verified" : "partial",
        ...(record && ["tracked", "manual", "estimated"].includes(record.source)
          ? { source: record.source }
          : previous && previous.source
            ? { source: previous.source }
            : {}),
        observedAt:
          Number.isSafeInteger(observedAt) && observedAt > 0
            ? Math.max(previous ? previous.observedAt : 0, observedAt)
            : previous
              ? previous.observedAt
              : weekStartAt
      });
    }
    return Array.from(byWeek.values())
      .sort((left, right) => left.weekStartAt - right.weekStartAt)
      .slice(-104);
  }

  function normalizeManualGuildPointWeeks(value) {
    const byWeek = new Map();
    for (const record of Array.isArray(value) ? value : []) {
      const weekStartAt = Number(record && record.weekStartAt);
      const earnedPoints = Number(record && record.earnedPoints);
      const observedAt = Number(record && record.observedAt);
      if (
        !Number.isSafeInteger(weekStartAt) ||
        weekStartAt <= 0 ||
        !Number.isSafeInteger(earnedPoints) ||
        earnedPoints < 0
      )
        continue;
      byWeek.set(weekStartAt, {
        weekStartAt,
        earnedPoints,
        observedAt: Number.isSafeInteger(observedAt) && observedAt > 0 ? observedAt : weekStartAt
      });
    }
    return Array.from(byWeek.values())
      .sort((left, right) => left.weekStartAt - right.weekStartAt)
      .slice(-104);
  }

  function normalizedGuildPointHistory(history) {
    const source = history && typeof history === "object" ? history : {};
    return {
      guildId: String(source.guildId || ""),
      lastObservation: guildPointObservation(source.lastObservation),
      weeks: normalizeGuildPointWeeks(source.weeks),
      manualWeeks: normalizeManualGuildPointWeeks(source.manualWeeks)
    };
  }

  function recordGuildPointObservation(history, rawObservation) {
    const observation = guildPointObservation(rawObservation);
    const previousHistory = normalizedGuildPointHistory(history);
    const { weeks, manualWeeks, lastObservation } = previousHistory;
    const guildId = String(previousHistory.guildId || (lastObservation && lastObservation.guildId) || "");
    if (!observation) return { changed: false, history: { guildId, lastObservation, weeks, manualWeeks } };

    const guildChanged = Boolean(
      lastObservation &&
      lastObservation.guildId &&
      observation.guildId &&
      lastObservation.guildId !== observation.guildId
    );
    if (!lastObservation || guildChanged || observation.lifetimePoints < lastObservation.lifetimePoints) {
      return {
        changed: true,
        history: {
          guildId: observation.guildId,
          lastObservation: observation,
          weeks: guildChanged || observation.lifetimePoints < (lastObservation?.lifetimePoints ?? 0) ? [] : weeks,
          manualWeeks: guildChanged ? [] : manualWeeks
        }
      };
    }

    const weekChanged = observation.weekStartAt !== lastObservation.weekStartAt;
    if (
      observation.weekStartAt &&
      lastObservation.weekStartAt &&
      observation.weekStartAt < lastObservation.weekStartAt
    ) {
      return {
        changed: false,
        history: { guildId: observation.guildId || guildId, lastObservation, weeks, manualWeeks }
      };
    }

    const earnedPoints = observation.lifetimePoints - lastObservation.lifetimePoints;
    if (!observation.weekStartAt && !lastObservation.weekStartAt) {
      return {
        changed: false,
        history: { guildId: observation.guildId || guildId, lastObservation, weeks, manualWeeks }
      };
    }

    const officialWeekGap =
      observation.weekStartAt && lastObservation.weekStartAt
        ? observation.weekStartAt - lastObservation.weekStartAt
        : null;
    const completedWeek = officialWeekGap !== null && officialWeekGap >= GUILD_POINT_WEEK_MS * 0.5;
    const ambiguousGap = officialWeekGap !== null && officialWeekGap > GUILD_POINT_WEEK_MS * 1.5;
    if (ambiguousGap) {
      return {
        changed: true,
        skippedAmbiguousIncrease: observation.lifetimePoints - lastObservation.lifetimePoints,
        history: {
          guildId: observation.guildId || guildId,
          lastObservation: observation,
          weeks: weeks.map((record) =>
            record.weekStartAt === lastObservation.weekStartAt
              ? { ...record, complete: true, coverage: "partial" }
              : record
          ),
          manualWeeks
        }
      };
    }

    if (!weekChanged && earnedPoints === 0) {
      return {
        changed: false,
        history: { guildId: observation.guildId || guildId, lastObservation, weeks, manualWeeks }
      };
    }
    if (!completedWeek && earnedPoints === 0) {
      return {
        changed: true,
        history: { guildId: observation.guildId || guildId, lastObservation: observation, weeks, manualWeeks }
      };
    }
    const targetWeekStart =
      observation.weekStartAt && lastObservation.weekStartAt && observation.weekStartAt > lastObservation.weekStartAt
        ? lastObservation.weekStartAt
        : observation.weekStartAt || lastObservation.weekStartAt || observation.observedAt;
    const attributedPoints = weekChanged ? 0 : earnedPoints;
    const nextWeeks = normalizeGuildPointWeeks([
      ...weeks,
      {
        weekStartAt: targetWeekStart,
        earnedPoints: attributedPoints,
        complete: completedWeek,
        coverage: "partial",
        observedAt: observation.observedAt
      }
    ]);
    return {
      changed: true,
      recordedPoints: attributedPoints,
      skippedAmbiguousIncrease: weekChanged ? earnedPoints : 0,
      history: {
        guildId: observation.guildId || guildId,
        lastObservation: observation,
        weeks: nextWeeks,
        manualWeeks
      }
    };
  }

  function setManualGuildPointWeek(
    history,
    rawWeekStartAt,
    rawEarnedPoints,
    observedAt,
    firstTrialStartAt,
    options = {}
  ) {
    const normalized = normalizedGuildPointHistory(history);
    const weekStartAt = Number(rawWeekStartAt);
    const earnedPoints = Number(rawEarnedPoints);
    const observed = Number(observedAt);
    const firstTrial = Number(firstTrialStartAt);
    const pastWeekCount = Math.floor((observed - firstTrial) / GUILD_POINT_WEEK_MS);
    const ordinal = (weekStartAt - firstTrial) / GUILD_POINT_WEEK_MS;
    if (
      !Number.isSafeInteger(weekStartAt) ||
      !Number.isSafeInteger(earnedPoints) ||
      earnedPoints < 0 ||
      !Number.isSafeInteger(observed) ||
      !Number.isSafeInteger(firstTrial) ||
      !Number.isInteger(ordinal) ||
      ordinal < 0 ||
      ordinal >= pastWeekCount
    )
      return { status: "invalid", history: normalized };
    if (
      options.allowTrackedOverride !== true &&
      normalized.weeks.some((record) => record.complete && record.weekStartAt === weekStartAt)
    )
      return { status: "tracked", history: normalized };
    return {
      status: "saved",
      history: {
        ...normalized,
        manualWeeks: normalizeManualGuildPointWeeks([
          ...normalized.manualWeeks.filter((record) => record.weekStartAt !== weekStartAt),
          { weekStartAt, earnedPoints, observedAt: observed }
        ])
      }
    };
  }

  function removeManualGuildPointWeek(history, rawWeekStartAt, options = {}) {
    const normalized = normalizedGuildPointHistory(history);
    const weekStartAt = Number(rawWeekStartAt);
    const manualWeeks = normalized.manualWeeks.filter((record) => record.weekStartAt !== weekStartAt);
    // A zero remains a valid observation unless the user explicitly clears it.
    const weeks =
      options.discardZeroTracked === true
        ? normalized.weeks.filter(
            (record) => !(record.weekStartAt === weekStartAt && record.complete && record.earnedPoints === 0)
          )
        : normalized.weeks;
    return {
      changed: manualWeeks.length !== normalized.manualWeeks.length || weeks.length !== normalized.weeks.length,
      history: { ...normalized, weeks, manualWeeks }
    };
  }

  function supplementGuildPointHistory(
    history,
    lifetimePoints,
    currentWeekPoints,
    observedAt,
    firstTrialStartAt,
    options = {}
  ) {
    const normalized = normalizedGuildPointHistory(history);
    const coldStart = estimateGuildPointColdStart(lifetimePoints, currentWeekPoints, observedAt, firstTrialStartAt);
    if (coldStart.status !== "ok") return { status: coldStart.status, history: normalized, estimatedCount: 0 };
    const firstTrial = Number(firstTrialStartAt);
    const completeTracked = new Map(
      normalized.weeks
        .filter((record) => record.complete && record.coverage === "verified" && record.source !== "estimated")
        .map((record) => [record.weekStartAt, record])
    );
    const manual = new Map(normalized.manualWeeks.map((record) => [record.weekStartAt, record]));
    const records = [];
    const missing = [];
    let knownPoints = 0;
    for (let index = 0; index < coldStart.pastWeekCount; index += 1) {
      const weekStartAt = firstTrial + index * GUILD_POINT_WEEK_MS;
      const trackedRecord = completeTracked.get(weekStartAt);
      const manualRecord = manual.get(weekStartAt);
      const record = manualRecord
        ? { ...manualRecord, complete: true, coverage: "verified", source: "manual" }
        : trackedRecord
          ? { ...trackedRecord, source: "tracked" }
          : null;
      if (record) {
        records.push(record);
        knownPoints += record.earnedPoints;
      } else {
        missing.push({ weekStartAt, ordinal: index + 1 });
      }
    }
    const historicalTotal = Number(lifetimePoints) - Number(currentWeekPoints);
    if (knownPoints > historicalTotal) {
      return {
        status: "known_points_exceed_total",
        history: normalized,
        estimatedCount: 0,
        manualCount: records.filter((record) => record.source === "manual").length,
        trackedCount: records.filter((record) => record.source === "tracked").length,
        averageWeeklyChange: null,
        forecastPoints: null,
        growthRate: null,
        forecastSampleCount: 0
      };
    }
    const remainingPoints = historicalTotal - knownPoints;
    const estimateBase = missing.length ? Math.floor(remainingPoints / missing.length) : 0;
    const estimateRemainder = missing.length ? remainingPoints % missing.length : 0;
    const estimates = missing.map((record, index) => ({
      weekStartAt: record.weekStartAt,
      earnedPoints: estimateBase + (index >= missing.length - estimateRemainder ? 1 : 0)
    }));
    for (const record of estimates) {
      records.push({
        weekStartAt: record.weekStartAt,
        earnedPoints: record.earnedPoints,
        complete: true,
        observedAt: Number(observedAt),
        source: "estimated"
      });
    }
    records.sort((left, right) => left.weekStartAt - right.weekStartAt);
    const currentWeekStartAt = firstTrial + coldStart.pastWeekCount * GUILD_POINT_WEEK_MS;
    const outsideRange = normalized.weeks.filter(
      (record) => record.weekStartAt < firstTrial || record.weekStartAt >= currentWeekStartAt
    );
    const forecast = summarizeGuildPointHistory(normalized, {
      forecastWeekCount: options.forecastWeekCount,
      currentWeekStartAt,
      currentWeekPoints
    });
    return {
      status: "ok",
      history: { ...normalized, weeks: [...records, ...outsideRange] },
      estimatedCount: estimates.length,
      manualCount: records.filter((record) => record.source === "manual").length,
      trackedCount: records.filter((record) => record.source === "tracked").length,
      averageWeeklyChange: forecast.averageWeeklyChange,
      forecastPoints: forecast.forecastPoints,
      growthRate: forecast.growthRate,
      forecastSampleCount: forecast.forecastSampleCount,
      forecast,
      currentWeekStartAt,
      historicalAveragePoints: coldStart.historicalAveragePoints
    };
  }

  function isReliableGuildPointWeek(record) {
    return (
      record.complete && record.source !== "estimated" && (record.source === "manual" || record.coverage === "verified")
    );
  }

  function isGuildPointForecastSample(record) {
    return (
      record.complete && record.source !== "estimated" && (isReliableGuildPointWeek(record) || record.earnedPoints > 0)
    );
  }

  function guildPointModelPrediction(samples, targetWeekStartAt, method = "mean") {
    if (samples.length < 2) return null;
    const origin = samples[0].weekStartAt;
    const xs = samples.map((record) => (record.weekStartAt - origin) / GUILD_POINT_WEEK_MS);
    const meanX = xs.reduce((sum, x) => sum + x, 0) / samples.length;
    const meanY = samples.reduce((sum, record) => sum + record.earnedPoints, 0) / samples.length;
    let prediction = meanY;
    if (method === "linear") {
      const variance = xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
      if (!variance) return null;
      const slope =
        samples.reduce((sum, record, i) => sum + (xs[i] - meanX) * (record.earnedPoints - meanY), 0) / variance;
      prediction += slope * ((targetWeekStartAt - origin) / GUILD_POINT_WEEK_MS - meanX);
    } else if (method === "legacy") {
      prediction =
        samples.at(-1).earnedPoints + (samples.at(-1).earnedPoints - samples[0].earnedPoints) / (samples.length - 1);
    }
    const rounded = Math.max(0, Math.round(prediction));
    return Number.isSafeInteger(rounded) ? rounded : null;
  }

  // Rolling-origin evaluation: every training window ends before its target week.
  // Estimates and unverified zeros are excluded; positive tracked values retain their coverage.
  function backtestGuildPointForecast(history, options = {}) {
    const lookback = normalizeGuildPointForecastWeeks(options.forecastWeekCount);
    const records = normalizeGuildPointWeeks(history?.weeks).filter(isGuildPointForecastSample);
    const results = ["mean", "linear", "legacy"].map((method) => ({
      method,
      count: 0,
      absoluteError: 0,
      overestimate: 0,
      overestimateCount: 0
    }));
    const predictions = [];
    for (const target of records) {
      if (Number.isFinite(options.beforeWeekStartAt) && target.weekStartAt >= options.beforeWeekStartAt) continue;
      const samples = records.filter(
        (record) =>
          record.weekStartAt < target.weekStartAt &&
          record.weekStartAt >= target.weekStartAt - lookback * GUILD_POINT_WEEK_MS
      );
      const row = { weekStartAt: target.weekStartAt, actual: target.earnedPoints };
      const candidates = results.map((result) => guildPointModelPrediction(samples, target.weekStartAt, result.method));
      if (candidates.some((value) => value === null)) continue;
      for (let i = 0; i < results.length; i += 1) {
        const result = results[i];
        const predicted = candidates[i];
        const error = predicted - target.earnedPoints;
        result.count += 1;
        result.absoluteError += Math.abs(error);
        result.overestimate += Math.max(0, error);
        result.overestimateCount += Number(error > 0);
        row[result.method] = predicted;
      }
      predictions.push(row);
    }
    const metrics = results.map((result) => ({
      ...result,
      meanAbsoluteError: result.count ? result.absoluteError / result.count : null,
      meanOverestimate: result.count ? result.overestimate / result.count : null
    }));
    return { lookback, metrics, predictions, recommendedMethod: "linear" };
  }

  function summarizeGuildPointHistory(history, options = {}) {
    const manual = normalizeManualGuildPointWeeks(history?.manualWeeks);
    const manualStarts = new Set(manual.map((record) => record.weekStartAt));
    const trackedWeeks = normalizeGuildPointWeeks([
      ...(history?.weeks || []).filter((record) => !manualStarts.has(record.weekStartAt)),
      ...manual.map((record) => ({ ...record, complete: true, source: "manual", coverage: "verified" }))
    ]);
    const currentWeekStartAt = Number.isSafeInteger(options.currentWeekStartAt)
      ? options.currentWeekStartAt
      : (trackedWeeks.filter((record) => record.complete).at(-1)?.weekStartAt ?? 0) + GUILD_POINT_WEEK_MS;
    const weeks = trackedWeeks.filter((record) => record.complete && record.weekStartAt < currentWeekStartAt);
    const currentWeekComplete = Number.isSafeInteger(options.currentWeekPoints) && options.currentWeekPoints > 0;
    const forecastEndAt = currentWeekStartAt + (currentWeekComplete ? GUILD_POINT_WEEK_MS : 0);
    // This transient sample never enters trackedWeeks, saved history, or exports.
    const completedWeeks = currentWeekComplete
      ? [
          ...weeks,
          {
            weekStartAt: currentWeekStartAt,
            earnedPoints: options.currentWeekPoints,
            complete: true,
            source: "tracked",
            coverage: "partial"
          }
        ]
      : weeks;
    const latest = completedWeeks.at(-1) || null;
    const previous = completedWeeks.at(-2) || null;
    const growthRate =
      latest &&
      previous &&
      isGuildPointForecastSample(latest) &&
      isGuildPointForecastSample(previous) &&
      latest.weekStartAt - previous.weekStartAt === GUILD_POINT_WEEK_MS &&
      previous.earnedPoints > 0
        ? (latest.earnedPoints - previous.earnedPoints) / previous.earnedPoints
        : null;
    const forecastWeekCount = normalizeGuildPointForecastWeeks(options.forecastWeekCount);
    const window = completedWeeks.filter(
      (record) => record.weekStartAt >= forecastEndAt - forecastWeekCount * GUILD_POINT_WEEK_MS
    );
    const samples = window.filter(isGuildPointForecastSample);
    const backtest = backtestGuildPointForecast(
      { weeks: window },
      { forecastWeekCount, beforeWeekStartAt: forecastEndAt }
    );
    const forecastMethod = "linear";
    const forecastPoints = guildPointModelPrediction(samples, currentWeekStartAt, forecastMethod);
    const nextWeekForecastPoints = guildPointModelPrediction(
      samples,
      currentWeekStartAt + GUILD_POINT_WEEK_MS,
      forecastMethod
    );
    return {
      trackedWeeks,
      weeks,
      latest,
      previous,
      growthRate,
      forecastPoints,
      nextWeekForecastPoints,
      averageWeeklyChange: null,
      forecastSampleCount: samples.length,
      verifiedSampleCount: samples.filter(isReliableGuildPointWeek).length,
      forecastSamples: samples,
      currentWeekComplete,
      forecastWeekCount,
      estimatedSampleCount: window.filter((record) => record.source === "estimated").length,
      partialSampleCount: window.filter((record) => record.source !== "estimated" && !isReliableGuildPointWeek(record))
        .length,
      forecastMethod,
      backtest,
      currentWeekStartAt,
      forecastStartAt: forecastEndAt - forecastWeekCount * GUILD_POINT_WEEK_MS,
      forecastEndAt
    };
  }

  function estimateGuildPointColdStart(lifetimePoints, currentWeekPoints, observedAt, firstTrialStartAt) {
    if (currentWeekPoints === null || currentWeekPoints === undefined)
      return { status: "unavailable", pastWeekCount: 0, forecastPoints: null };
    const lifetime = Number(lifetimePoints);
    const currentWeek = Number(currentWeekPoints);
    const observed = Number(observedAt);
    const firstTrial = Number(firstTrialStartAt);
    if (
      !Number.isSafeInteger(lifetime) ||
      lifetime < 0 ||
      !Number.isSafeInteger(currentWeek) ||
      currentWeek < 0 ||
      currentWeek > lifetime ||
      !Number.isSafeInteger(observed) ||
      observed <= 0 ||
      !Number.isSafeInteger(firstTrial) ||
      firstTrial <= 0
    ) {
      return { status: "unavailable", pastWeekCount: 0, forecastPoints: null };
    }
    if (observed < firstTrial) {
      return { status: "before_first_trial", pastWeekCount: 0, forecastPoints: null };
    }
    const pastWeekCount = Math.floor((observed - firstTrial) / GUILD_POINT_WEEK_MS);
    if (pastWeekCount < 1) {
      return { status: "insufficient_history", pastWeekCount, forecastPoints: null };
    }
    const historicalAveragePoints = (lifetime - currentWeek) / pastWeekCount;
    const latestWeekOrdinal = pastWeekCount + 1;
    const historicalMidpoint = (pastWeekCount + 1) / 2;
    const weeklyGrowthPoints = null;
    const forecastPoints = Math.max(0, Math.round(historicalAveragePoints));
    return {
      status: "ok",
      pastWeekCount,
      historicalAveragePoints,
      currentWeekPoints: currentWeek,
      historicalMidpoint,
      latestWeekOrdinal,
      weeklyGrowthPoints,
      growthRate: null,
      forecastPoints
    };
  }

  function estimateGuildConstructionWeeks(totalCost, availablePoints, weeklyForecast, options = {}) {
    const cost = Number(totalCost);
    if (!Number.isSafeInteger(cost) || cost <= 0)
      return { status: "no_plan", shortfall: 0, weeks: null, weeklyForecast: null };
    const available = availablePoints === null || availablePoints === undefined ? NaN : Number(availablePoints);
    if (!Number.isSafeInteger(available) || available < 0)
      return { status: "missing_balance", shortfall: null, weeks: null, weeklyForecast: null };
    const shortfall = Math.max(0, cost - available);
    if (shortfall === 0) return { status: "covered", shortfall, weeks: 0, weeklyForecast: null };
    const forecast = weeklyForecast === null || weeklyForecast === undefined ? NaN : Number(weeklyForecast);
    if (!Number.isSafeInteger(forecast) || forecast < 0)
      return { status: "missing_forecast", shortfall, weeks: null, weeklyForecast: null };
    const remaining = options.currentWeekRemaining;
    if (Object.hasOwn(options, "currentWeekRemaining")) {
      if (!Number.isSafeInteger(remaining) || remaining < 0)
        return { status: "missing_forecast", shortfall, weeks: null, weeklyForecast: forecast };
      if (shortfall <= remaining) return { status: "ok", shortfall, weeks: 1, weeklyForecast: forecast };
      if (forecast === 0) return { status: "no_growth", shortfall, weeks: null, weeklyForecast: forecast };
      return {
        status: "ok",
        shortfall,
        weeks: 1 + Math.ceil((shortfall - remaining) / forecast),
        weeklyForecast: forecast
      };
    }
    if (forecast === 0) return { status: "no_growth", shortfall, weeks: null, weeklyForecast: forecast };
    return {
      status: "ok",
      shortfall,
      weeks: Math.ceil(shortfall / forecast),
      weeklyForecast: forecast
    };
  }

  function calculateGuildPointPlanningBudget(basePoints, weeklyForecast, planningWeeks, options = {}) {
    const base = basePoints === null || basePoints === undefined ? NaN : Number(basePoints);
    const weeks = Number(planningWeeks);
    if (!Number.isSafeInteger(base) || base < 0)
      return { status: "missing_balance", basePoints: null, weeks: 0, forecastPoints: null, budget: null };
    if (!Number.isSafeInteger(weeks) || weeks < 0 || weeks > 12)
      return { status: "invalid_weeks", basePoints: base, weeks: 0, forecastPoints: null, budget: base };
    if (weeks === 0) return { status: "ok", basePoints: base, weeks, forecastPoints: null, budget: base };
    const forecast = weeklyForecast === null || weeklyForecast === undefined ? NaN : Number(weeklyForecast);
    if (!Number.isSafeInteger(forecast) || forecast < 0)
      return { status: "missing_forecast", basePoints: base, weeks, forecastPoints: null, budget: base };
    const includesCurrentWeek = Object.hasOwn(options, "currentWeekRemaining");
    const remaining = options.currentWeekRemaining;
    if (includesCurrentWeek && (!Number.isSafeInteger(remaining) || remaining < 0))
      return { status: "missing_forecast", basePoints: base, weeks, forecastPoints: null, budget: base };
    const addedPoints = includesCurrentWeek ? remaining + (weeks - 1) * forecast : weeks * forecast;
    if (!Number.isSafeInteger(base + addedPoints))
      return { status: "missing_forecast", basePoints: base, weeks, forecastPoints: null, budget: base };
    return {
      status: "ok",
      basePoints: base,
      weeks,
      forecastPoints: forecast,
      budget: base + addedPoints,
      ...(includesCurrentWeek ? { currentWeekRemaining: remaining, futureWeeks: weeks - 1, addedPoints } : {})
    };
  }

  function allocateSurplusGuildTokens(creditRows, exchangeRules, availableGuildTokens) {
    const budget = Math.max(0, Math.floor(Number(availableGuildTokens) || 0));
    const rules = new Map();
    for (const rule of Array.isArray(exchangeRules) ? exchangeRules : []) {
      const creditItemHrid = rule && rule.creditItemHrid;
      const guildTokenCount = positiveInteger(rule && rule.guildTokenCount);
      const creditCount = positiveInteger(rule && rule.creditCount);
      if (!creditItemHrid || !guildTokenCount || !creditCount || rules.has(creditItemHrid)) continue;
      rules.set(creditItemHrid, { creditItemHrid, guildTokenCount, creditCount });
    }

    const candidates = (Array.isArray(creditRows) ? creditRows : [])
      .map((row) => {
        const rule = row && rules.get(row.itemHrid);
        const missing = Math.max(0, Number(row && row.missing) || 0);
        const unitCost = Number(row && row.unitCost);
        if (!rule || missing <= 0 || !Number.isFinite(unitCost) || unitCost <= 0) return null;
        return {
          ...rule,
          missing,
          goldValuePerToken: (unitCost * rule.creditCount) / rule.guildTokenCount
        };
      })
      .filter(Boolean)
      .sort(
        (left, right) =>
          right.goldValuePerToken - left.goldValuePerToken || left.creditItemHrid.localeCompare(right.creditItemHrid)
      );

    let remainingGuildTokens = budget;
    const allocations = [];
    for (const candidate of candidates) {
      const affordableBatches = Math.floor(remainingGuildTokens / candidate.guildTokenCount);
      const requiredBatches = Math.ceil(candidate.missing / candidate.creditCount);
      const batches = Math.min(affordableBatches, requiredBatches);
      if (batches <= 0) continue;
      const spentGuildTokens = batches * candidate.guildTokenCount;
      const actualCredits = batches * candidate.creditCount;
      allocations.push({
        ...candidate,
        batches,
        actualCredits,
        coveredCredits: Math.min(candidate.missing, actualCredits),
        spentGuildTokens
      });
      remainingGuildTokens -= spentGuildTokens;
    }

    return {
      availableGuildTokens: budget,
      spentGuildTokens: budget - remainingGuildTokens,
      remainingGuildTokens,
      allocations
    };
  }

  function estimateGuildUpgradeCosts(totals, creditUnitCosts, inventoryCounts, options) {
    const unitCosts = creditUnitCosts && typeof creditUnitCosts === "object" ? creditUnitCosts : {};
    const inventory = inventoryCounts && typeof inventoryCounts === "object" ? inventoryCounts : {};
    const settings = options && typeof options === "object" ? options : {};
    const autoAllocateSurplusGuildTokens = settings.autoAllocateSurplusGuildTokens === true;
    const useGuildTokensForAllMissingCredits = settings.useGuildTokensForMissingCredits === true;
    const guildTokenCreditHrids = new Set(
      Array.isArray(settings.guildTokenCreditHrids)
        ? settings.guildTokenCreditHrids.filter((itemHrid) => typeof itemHrid === "string" && itemHrid)
        : []
    );
    const useGuildTokensForMissingCredits = useGuildTokensForAllMissingCredits || guildTokenCreditHrids.size > 0;
    const guildTokenCreditRules = new Map();
    for (const rule of Array.isArray(settings.guildTokenCreditConversions)
      ? settings.guildTokenCreditConversions
      : []) {
      const creditItemHrid = rule && rule.creditItemHrid;
      const guildTokenCount = positiveInteger(rule && rule.guildTokenCount);
      const creditCount = positiveInteger(rule && rule.creditCount);
      if (!creditItemHrid || !guildTokenCount || !creditCount || guildTokenCreditRules.has(creditItemHrid)) continue;
      guildTokenCreditRules.set(creditItemHrid, { creditItemHrid, guildTokenCount, creditCount });
    }
    const rows = [];
    const unpricedItemHrids = [];
    let totalGold = 0;
    let missingGold = 0;
    let guildTokensRequired = 0;
    const guildTokensOwned = Math.max(0, Number(inventory["/items/guild_token"]) || 0);
    let guildTokenCreditExchangeRequired = 0;
    let guildTokenRow = null;

    for (const item of Array.isArray(totals) ? totals : []) {
      const itemHrid = item && item.itemHrid;
      const required = Number(item && item.count);
      if (!itemHrid || !Number.isFinite(required) || required <= 0) continue;
      const owned = Math.max(0, Number(inventory[itemHrid]) || 0);
      const missing = Math.max(0, required - owned);
      if (itemHrid === "/items/guild_token") {
        guildTokensRequired += required;
        guildTokenRow = { itemHrid, required, owned, missing, unitCost: null, totalCost: null, missingCost: null };
        rows.push(guildTokenRow);
        continue;
      }
      const guildTokenRule =
        (useGuildTokensForAllMissingCredits || guildTokenCreditHrids.has(itemHrid)) &&
        guildTokenCreditRules.get(itemHrid);
      if (guildTokenRule) {
        const batches = missing > 0 ? Math.ceil(missing / guildTokenRule.creditCount) : 0;
        const requiredGuildTokens = batches * guildTokenRule.guildTokenCount;
        guildTokenCreditExchangeRequired += requiredGuildTokens;
        rows.push({
          itemHrid,
          required,
          owned,
          missing,
          unitCost: null,
          totalCost: null,
          missingCost: null,
          guildTokenExchange: {
            ...guildTokenRule,
            batches,
            actualCredits: batches * guildTokenRule.creditCount,
            requiredGuildTokens
          }
        });
        continue;
      }
      const unitCost = Number(unitCosts[itemHrid]);
      const priced = Number.isFinite(unitCost) && unitCost > 0;
      if (priced) {
        totalGold += required * unitCost;
        missingGold += missing * unitCost;
      } else {
        unpricedItemHrids.push(itemHrid);
      }
      rows.push({
        itemHrid,
        required,
        owned,
        missing,
        unitCost: priced ? unitCost : null,
        totalCost: priced ? required * unitCost : null,
        missingCost: priced ? missing * unitCost : null
      });
    }

    const manualGuildTokenCreditExchangeRequired = guildTokenCreditExchangeRequired;
    const reservedGuildTokens = guildTokensRequired + manualGuildTokenCreditExchangeRequired;
    const availableSurplusGuildTokens = autoAllocateSurplusGuildTokens
      ? Math.max(0, Math.floor(guildTokensOwned - reservedGuildTokens))
      : 0;
    const requestedAutoGuildTokenBudget = Number(settings.autoGuildTokenBudget);
    const hasConfiguredAutoGuildTokenBudget =
      settings.autoGuildTokenBudget !== null &&
      settings.autoGuildTokenBudget !== undefined &&
      Number.isFinite(requestedAutoGuildTokenBudget) &&
      requestedAutoGuildTokenBudget >= 0;
    const autoGuildTokenBudget = hasConfiguredAutoGuildTokenBudget
      ? Math.min(availableSurplusGuildTokens, Math.floor(requestedAutoGuildTokenBudget))
      : availableSurplusGuildTokens;
    const autoGuildTokenPlan = allocateSurplusGuildTokens(
      rows,
      Array.from(guildTokenCreditRules.values()),
      autoGuildTokenBudget
    );
    const autoAllocationsByCredit = new Map(
      autoGuildTokenPlan.allocations.map((allocation) => [allocation.creditItemHrid, allocation])
    );
    if (autoAllocateSurplusGuildTokens) {
      for (const row of rows) {
        if (!guildTokenCreditRules.has(row.itemHrid) || row.guildTokenExchange) continue;
        const allocation = autoAllocationsByCredit.get(row.itemHrid);
        row.remainingMissing = row.missing;
        if (!allocation) continue;
        row.autoGuildTokenExchange = allocation;
        row.remainingMissing = Math.max(0, row.missing - allocation.coveredCredits);
        if (row.unitCost !== null) {
          const coveredGold = allocation.coveredCredits * row.unitCost;
          totalGold = Math.max(0, totalGold - coveredGold);
          missingGold = Math.max(0, missingGold - coveredGold);
          row.totalCost = Math.max(0, row.totalCost - coveredGold);
          row.missingCost = row.remainingMissing * row.unitCost;
        }
      }
    }
    const autoGuildTokenCreditExchangeUsed = autoGuildTokenPlan.spentGuildTokens;
    guildTokenCreditExchangeRequired += autoGuildTokenCreditExchangeUsed;
    guildTokensRequired += guildTokenCreditExchangeRequired;
    const guildTokensMissing = Math.max(0, guildTokensRequired - guildTokensOwned);
    if (guildTokensRequired > 0) {
      if (!guildTokenRow) {
        guildTokenRow = {
          itemHrid: "/items/guild_token",
          required: guildTokensRequired,
          owned: guildTokensOwned,
          missing: guildTokensMissing,
          unitCost: null,
          totalCost: null,
          missingCost: null
        };
        rows.push(guildTokenRow);
      } else {
        guildTokenRow.required = guildTokensRequired;
        guildTokenRow.missing = guildTokensMissing;
      }
      guildTokenRow.shrineRequired = guildTokensRequired - guildTokenCreditExchangeRequired;
      guildTokenRow.creditExchangeRequired = guildTokenCreditExchangeRequired;
      if (autoAllocateSurplusGuildTokens) {
        guildTokenRow.manualCreditExchangeRequired = manualGuildTokenCreditExchangeRequired;
        guildTokenRow.autoCreditExchangeUsed = autoGuildTokenCreditExchangeUsed;
      }
    }

    return {
      status: unpricedItemHrids.length ? "partial" : "ok",
      totalGold,
      missingGold,
      guildTokensRequired,
      guildTokensOwned,
      guildTokensMissing,
      guildTokenCreditExchangeRequired,
      manualGuildTokenCreditExchangeRequired,
      autoGuildTokenCreditExchangeUsed,
      autoGuildTokenBudgetAvailable: availableSurplusGuildTokens,
      autoGuildTokenBudget,
      autoGuildTokenAllocations: autoGuildTokenPlan.allocations,
      useGuildTokensForMissingCredits: useGuildTokensForMissingCredits || autoGuildTokenCreditExchangeUsed > 0,
      guildTokenCreditHrids: Array.from(guildTokenCreditHrids),
      unpricedItemHrids,
      rows
    };
  }

  function conversionsFromItemDetails(itemDetails, creditItemHrid) {
    const details = Array.isArray(itemDetails)
      ? itemDetails.map((detail) => [detail && (detail.itemHrid || detail.hrid), detail])
      : Object.entries(itemDetails || {});
    return details.flatMap(([itemKey, detail]) =>
      (detail && Array.isArray(detail.guildCreditConversions) ? detail.guildCreditConversions : [])
        .filter((conversion) => conversion.creditItemHrid === creditItemHrid)
        .map((conversion) => ({
          itemHrid: detail.itemHrid || detail.hrid || itemKey,
          itemName: detail.name || detail.itemHrid || detail.hrid || itemKey,
          creditItemHrid: conversion.creditItemHrid,
          itemCount: conversion.itemCount,
          creditCount: conversion.creditCount
        }))
        .filter(
          (conversion) =>
            conversion.itemHrid && positiveInteger(conversion.itemCount) && positiveInteger(conversion.creditCount)
        )
    );
  }

  // Official buffs use the base value at level 1, then a separate bonus per level.
  function guildBuffLevelEffects(detail) {
    if (!Array.isArray(detail?.buffs)) return [];
    const finite = (value) => typeof value === "number" && Number.isFinite(value);
    return detail.buffs.flatMap((buff) => {
      if (!buff || typeof buff.typeHrid !== "string") return [];
      return ["ratio", "flat"].flatMap((kind) => {
        const first = buff[`${kind}Boost`];
        const increment = buff[`${kind}BoostLevelBonus`] ?? 0;
        if (!finite(first) || !finite(increment) || (first === 0 && increment === 0)) return [];
        return [{ typeHrid: buff.typeHrid, kind, first, increment }];
      });
    });
  }

  function guildBuffEffectAtLevel(effect, level) {
    if (
      !Number.isSafeInteger(level) ||
      level < 0 ||
      !effect ||
      !Number.isFinite(effect.first) ||
      !Number.isFinite(effect.increment)
    )
      return null;
    const value = level === 0 ? 0 : effect.first + (level - 1) * effect.increment;
    return Number.isFinite(value) ? value : null;
  }

  function guildBuffUpgradePreview(detail, startLevel, targetLevel) {
    const cost = aggregateGuildBuffLevelCosts(detail?.levelCosts, startLevel, targetLevel);
    if (cost.status !== "ok") return { ...cost, effects: [], steps: [] };
    const effects = guildBuffLevelEffects(detail);
    const comparison = effects.map((effect) => {
      const start = guildBuffEffectAtLevel(effect, cost.startLevel);
      const target = guildBuffEffectAtLevel(effect, cost.targetLevel);
      const difference = start !== null && target !== null ? target - start : null;
      return { ...effect, start, target, gain: Number.isFinite(difference) ? difference : null };
    });
    return {
      ...cost,
      effects: comparison,
      steps: Array.from({ length: cost.targetLevel - cost.startLevel }, (_, index) => {
        const level = cost.startLevel + index + 1;
        return {
          level,
          effects: effects.map((effect) => ({ ...effect, value: guildBuffEffectAtLevel(effect, level) })),
          totals: aggregateGuildBuffLevelCosts(detail.levelCosts, level - 1, level).totals
        };
      })
    };
  }

  function isUnitPriceWithinLimit(unitPrice, maxUnitPrice) {
    const limit = Number(maxUnitPrice);
    if (!Number.isSafeInteger(limit) || limit <= 0) return true;
    const price = Number(unitPrice);
    return !Number.isFinite(price) || price <= 0 || price <= limit;
  }

  return {
    guildBuffLevelEffects,
    guildBuffEffectAtLevel,
    guildBuffUpgradePreview,
    normalizeAsks,
    quoteAsks,
    evaluateConversion,
    rankConversions,
    rankGuildTokenCreditValues,
    evaluateBudgetConversion,
    bestConversionForBudget,
    calculateSaleProceeds,
    estimateSaleReplacement,
    snapshotMarketPrice,
    formatCompactCost,
    compareVersions,
    selectGuildShrineAutofillScope,
    aggregateGuildBuffLevelCosts,
    aggregateGuildBuffPlans,
    aggregateGuildBuildingLevelCosts,
    buildGuildConstructionPlan,
    normalizeGuildPointForecastWeeks,
    recordGuildPointObservation,
    setManualGuildPointWeek,
    removeManualGuildPointWeek,
    supplementGuildPointHistory,
    summarizeGuildPointHistory,
    backtestGuildPointForecast,
    guildPointModelPrediction,
    estimateGuildPointColdStart,
    estimateGuildConstructionWeeks,
    calculateGuildPointPlanningBudget,
    allocateSurplusGuildTokens,
    estimateGuildUpgradeCosts,
    conversionsFromItemDetails,
    isUnitPriceWithinLimit,
    guildTokenBudgetPercentage,
    snapGuildTokenBudget
  };
});


// SOURCE: src/shrine-guide.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildCreditShrineGuide = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function positiveInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  function nonNegativeInteger(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
  }

  function nonNegativeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  function normalizePlan(plan) {
    if (!plan || typeof plan.guildBuffHrid !== "string" || typeof plan.shrineHrid !== "string") return null;
    const targetLevel = positiveInteger(plan.targetLevel);
    const currentLevel = Math.max(0, Math.floor(Number(plan.currentLevel) || 0));
    if (!targetLevel) return null;
    return {
      guildBuffHrid: plan.guildBuffHrid,
      shrineHrid: plan.shrineHrid,
      domain: plan.domain === "combat" ? "combat" : "life",
      label: String(plan.label || plan.guildBuffHrid),
      currentLevel,
      targetLevel,
      complete: currentLevel >= targetLevel
    };
  }

  function inventoryCountForItem(characterItems, itemHrid) {
    if (!Array.isArray(characterItems) || !itemHrid) return null;
    let total = 0;
    for (const item of characterItems) {
      if (!item || item.itemHrid !== itemHrid || item.itemLocationHrid !== "/item_locations/inventory") continue;
      const count = nonNegativeInteger(item.count);
      if (count !== null) total += count;
    }
    return total;
  }

  function normalizeCreditStep(row, materialPlan) {
    if (!row || !row.itemHrid) return null;
    const remainingMissing = Math.ceil(nonNegativeNumber(row && (row.remainingMissing ?? row.missing)));
    const automaticExchange = row.guildTokenExchange ? null : row.autoGuildTokenExchange;
    const hasAutomaticExchange = Boolean(
      automaticExchange &&
      positiveInteger(automaticExchange.batches) &&
      positiveInteger(automaticExchange.spentGuildTokens) &&
      positiveInteger(automaticExchange.actualCredits)
    );
    if (remainingMissing <= 0 && !hasAutomaticExchange) return null;
    if (row.guildTokenExchange || hasAutomaticExchange) {
      const exchange = row.guildTokenExchange || automaticExchange;
      return {
        creditItemHrid: row.itemHrid,
        remainingMissing: hasAutomaticExchange ? Math.ceil(nonNegativeNumber(row.missing)) : remainingMissing,
        method: "guild_token",
        recommendedItemHrid: "/items/guild_token",
        batches: positiveInteger(exchange.batches) || 0,
        requiredItems: positiveInteger(exchange.requiredGuildTokens) || positiveInteger(exchange.spentGuildTokens) || 0,
        actualCredits: positiveInteger(exchange.actualCredits) || 0,
        itemCount: positiveInteger(exchange.guildTokenCount) || 0,
        creditCount: positiveInteger(exchange.creditCount) || 0
      };
    }
    if (!materialPlan) {
      return {
        creditItemHrid: row.itemHrid,
        remainingMissing,
        method: "unavailable",
        recommendedItemHrid: null,
        batches: 0,
        requiredItems: 0,
        actualCredits: 0,
        itemCount: 0,
        creditCount: 0
      };
    }
    const itemCount = positiveInteger(materialPlan.itemCount) || 0;
    const creditCount = positiveInteger(materialPlan.creditCount) || 0;
    const batches =
      positiveInteger(materialPlan.batches) || (creditCount ? Math.ceil(remainingMissing / creditCount) : 0);
    return {
      creditItemHrid: row.itemHrid,
      remainingMissing,
      method: "market_item",
      recommendedItemHrid: materialPlan.itemHrid || null,
      batches,
      requiredItems: positiveInteger(materialPlan.requiredItems) || batches * itemCount,
      actualCredits: positiveInteger(materialPlan.actualCredits) || batches * creditCount,
      itemCount,
      creditCount
    };
  }

  function deriveShrineGuide(options) {
    const settings = options && typeof options === "object" ? options : {};
    const plans = (Array.isArray(settings.plans) ? settings.plans : []).map(normalizePlan).filter(Boolean);
    const base = {
      enabled: settings.enabled === true,
      status: "inactive",
      plans,
      targetPlans: plans.filter((plan) => !plan.complete),
      missingCredits: [],
      blockers: [],
      activeCredit: null
    };
    if (!base.enabled) return base;
    if (!plans.length) return { ...base, status: "no_plans" };
    if (!base.targetPlans.length) return { ...base, status: "complete" };
    if (!settings.estimate || !Array.isArray(settings.estimate.rows)) return { ...base, status: "loading" };

    const creditOrder = Array.isArray(settings.creditOrder) ? settings.creditOrder : [];
    const creditIndex = new Map(creditOrder.map((itemHrid, index) => [itemHrid, index]));
    const creditSet = new Set(creditOrder);
    const materialPlans =
      settings.creditMaterialPlans && typeof settings.creditMaterialPlans === "object"
        ? settings.creditMaterialPlans
        : {};
    const missingCredits = settings.estimate.rows
      .filter((row) => creditSet.has(row && row.itemHrid))
      .map((row) => normalizeCreditStep(row, materialPlans[row.itemHrid]))
      .filter(Boolean)
      .sort(
        (left, right) =>
          (creditIndex.get(left.creditItemHrid) ?? Number.MAX_SAFE_INTEGER) -
          (creditIndex.get(right.creditItemHrid) ?? Number.MAX_SAFE_INTEGER)
      );
    const blockers = settings.estimate.rows
      .filter(
        (row) => row && !creditSet.has(row.itemHrid) && nonNegativeNumber(row.remainingMissing ?? row.missing) > 0
      )
      .map((row) => ({
        itemHrid: row.itemHrid,
        missing: Math.ceil(nonNegativeNumber(row.remainingMissing ?? row.missing))
      }));
    const modal = settings.modal && typeof settings.modal === "object" ? settings.modal : null;
    const matchedCredit =
      (modal && missingCredits.find((step) => step.creditItemHrid === modal.creditItemHrid)) || null;
    const legacyModalMaxBatches = nonNegativeInteger(modal && modal.maxBatches);
    const modalMaxTargetQuantity = nonNegativeInteger(modal && modal.maxTargetQuantity);
    const inputMaxBatches =
      matchedCredit && modalMaxTargetQuantity !== null && matchedCredit.creditCount > 0
        ? Math.floor(modalMaxTargetQuantity / matchedCredit.creditCount)
        : null;
    const ownedItems = matchedCredit
      ? inventoryCountForItem(settings.characterItems, matchedCredit.recommendedItemHrid)
      : null;
    const inventoryMaxBatches =
      matchedCredit && ownedItems !== null && matchedCredit.itemCount > 0
        ? Math.floor(ownedItems / matchedCredit.itemCount)
        : null;
    const availableBatchLimits = [legacyModalMaxBatches, inputMaxBatches, inventoryMaxBatches].filter(
      (value) => value !== null
    );
    const modalMaxBatches = availableBatchLimits.length ? Math.min(...availableBatchLimits) : null;
    const suggestedBatches = matchedCredit
      ? Math.min(matchedCredit.batches, modalMaxBatches === null ? matchedCredit.batches : modalMaxBatches)
      : 0;
    const activeCredit = matchedCredit
      ? {
          ...matchedCredit,
          maxBatches: modalMaxBatches,
          suggestedBatches,
          suggestedItems: suggestedBatches * matchedCredit.itemCount,
          suggestedCredits: suggestedBatches * matchedCredit.creditCount
        }
      : null;
    const result = { ...base, missingCredits, blockers, activeCredit };

    if (activeCredit) {
      if (activeCredit.method === "unavailable") return { ...result, status: "unavailable" };
      if (modal.selectedItemHrid === activeCredit.recommendedItemHrid) return { ...result, status: "set_quantity" };
      if (activeCredit.method === "guild_token") return { ...result, status: "use_guild_token" };
      return { ...result, status: "choose_item" };
    }
    if (missingCredits.length) return { ...result, status: "choose_credit" };
    if (blockers.length) return { ...result, status: "blocked" };
    return { ...result, status: "upgrade_shrine" };
  }

  return { deriveShrineGuide, inventoryCountForItem };
});


// SOURCE: src/trial-display.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildTrialDisplay = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const combatMetrics = ["damageDealt", "healingDone", "premitigatedDamageTaken"];
  const aggregates = ["total", "average", "median"];
  const groups = [
    { key: "basic", fields: ["member", "level"] },
    { key: "skilling", fields: ["workDone", "workShare", "workMultiple"] },
    ...combatMetrics.map((key) => ({ key, fields: [key, `${key}Share`, `${key}Multiple`] })),
    ...["level", "workDone"].map((key) => ({
      key: `${key}Summary`,
      fields: aggregates.map((aggregate) => `${key}_${aggregate}`)
    }))
  ];
  const defaults = Object.fromEntries(
    groups.flatMap(({ fields }) => fields.map((field) => [field, !/(Share|Multiple)$/.test(field)]))
  );

  const rankingColumns = [
    "joinedAt",
    "participations",
    "skilling",
    "combat",
    "all",
    "damageDealt",
    "healingDone",
    "premitigatedDamageTaken"
  ];
  function normalizeRankingOrder(value) {
    return [
      ...new Set([
        ...(Array.isArray(value) ? value.filter((key) => rankingColumns.includes(key)) : []),
        ...rankingColumns
      ])
    ];
  }

  function normalize(value) {
    return Object.fromEntries(
      Object.entries(defaults).map(([field, fallback]) => {
        let legacy;
        if (combatMetrics.some((metric) => field === `${metric}Share`)) legacy = "combatShare";
        if (combatMetrics.some((metric) => field === `${metric}Multiple`)) legacy = "combatMultiple";
        if (field.startsWith("level_")) legacy = "levelSummary";
        if (field.startsWith("workDone_")) legacy = "workSummary";
        return [
          field,
          typeof value?.[field] === "boolean"
            ? value[field]
            : legacy && typeof value?.[legacy] === "boolean"
              ? value[legacy]
              : fallback
        ];
      })
    );
  }

  function fields(kind, settings) {
    const all = [
      "member",
      "level",
      ...(kind === "combat"
        ? combatMetrics.flatMap((field) => [field, `${field}Share`, `${field}Multiple`])
        : ["workDone", "workShare", "workMultiple"])
    ];
    return all.filter((field) => settings[field] !== false);
  }

  function preset(name) {
    if (name === "default") return { ...defaults };
    if (name === "all") return Object.fromEntries(Object.keys(defaults).map((field) => [field, true]));
    if (name === "compact")
      return Object.fromEntries(
        Object.keys(defaults).map((field) => [field, ["member", "level", "workDone", ...combatMetrics].includes(field)])
      );
    return null;
  }

  return { groups, defaults, normalize, fields, preset, rankingColumns, normalizeRankingOrder };
});


// SOURCE: src/runtime/storage.js
(function (root, factory) {
  const api = factory(
    typeof module !== "undefined" && module.exports ? require("../trial-display.js") : root.MwiGuildTrialDisplay
  );
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildCreditStorage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (displayApi) {
  "use strict";

  const GUILD_BUFF_HRID_PATTERN = /^\/guild_buffs\/[A-Za-z0-9_./-]+$/;
  const GUILD_POINT_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const LEGACY_GUILD_TRIAL_FIRST_START_AT = Date.parse("2026-07-13T00:00:00Z");
  const GUILD_BUILDING_PLANNER_SCHEMA_VERSION = 8;

  function normalizeGuildShrineAutofillExcludedBuffHrids(value) {
    const values =
      Array.isArray(value) || (value && typeof value !== "string" && typeof value[Symbol.iterator] === "function")
        ? Array.from(value)
        : [];
    return Array.from(
      new Set(
        values.filter(
          (guildBuffHrid) => typeof guildBuffHrid === "string" && GUILD_BUFF_HRID_PATTERN.test(guildBuffHrid)
        )
      )
    );
  }

  function normalizePanelView(view, panelViews) {
    return panelViews.includes(view) ? view : "credit";
  }

  function normalizeSidebarDisplayName(value) {
    return typeof value === "string" ? Array.from(value.trim().replace(/\s+/g, " ")).slice(0, 24).join("") : "";
  }

  function normalizePanelOrder(order, panelViews, defaultOrder = panelViews) {
    const allowed = new Set(panelViews);
    const normalized = [];
    for (const view of Array.isArray(order) ? order : []) {
      if (allowed.has(view) && !normalized.includes(view)) normalized.push(view);
    }
    for (const view of defaultOrder) {
      if (allowed.has(view) && !normalized.includes(view)) normalized.push(view);
    }
    for (const view of panelViews) {
      if (!normalized.includes(view)) normalized.push(view);
    }
    return normalized;
  }

  function normalizeGuildPointHistory(value) {
    const source = value && typeof value === "object" ? value : {};
    const normalizeObservation = (observation) => {
      const lifetimePoints = Number(observation && observation.lifetimePoints);
      const availablePoints = Number(observation && observation.availablePoints);
      const weekStartAt = Number(observation && observation.weekStartAt);
      const observedAt = Number(observation && observation.observedAt);
      if (
        !Number.isSafeInteger(lifetimePoints) ||
        lifetimePoints < 0 ||
        !Number.isSafeInteger(availablePoints) ||
        availablePoints < 0 ||
        !Number.isSafeInteger(observedAt) ||
        observedAt <= 0
      )
        return null;
      return {
        guildId: String((observation && observation.guildId) || "").slice(0, 160),
        lifetimePoints,
        availablePoints,
        weekStartAt: Number.isSafeInteger(weekStartAt) && weekStartAt > 0 ? weekStartAt : null,
        observedAt
      };
    };
    const byWeek = new Map();
    for (const record of Array.isArray(source.weeks) ? source.weeks : []) {
      const weekStartAt = Number(record && record.weekStartAt);
      const earnedPoints = Number(record && record.earnedPoints);
      const observedAt = Number(record && record.observedAt);
      if (
        !Number.isSafeInteger(weekStartAt) ||
        weekStartAt <= 0 ||
        !Number.isSafeInteger(earnedPoints) ||
        earnedPoints < 0
      )
        continue;
      const previous = byWeek.get(weekStartAt);
      byWeek.set(weekStartAt, {
        weekStartAt,
        earnedPoints: previous ? previous.earnedPoints + earnedPoints : earnedPoints,
        complete: Boolean((previous && previous.complete) || (record && record.complete)),
        coverage:
          record?.coverage === "verified" && (!previous || previous.coverage === "verified") ? "verified" : "partial",
        ...(record && ["tracked", "manual", "estimated"].includes(record.source) ? { source: record.source } : {}),
        observedAt:
          Number.isSafeInteger(observedAt) && observedAt > 0
            ? Math.max(previous ? previous.observedAt : 0, observedAt)
            : previous
              ? previous.observedAt
              : weekStartAt
      });
    }
    const manualByWeek = new Map();
    for (const record of Array.isArray(source.manualWeeks) ? source.manualWeeks : []) {
      const weekStartAt = Number(record && record.weekStartAt);
      const earnedPoints = Number(record && record.earnedPoints);
      const observedAt = Number(record && record.observedAt);
      if (
        !Number.isSafeInteger(weekStartAt) ||
        weekStartAt <= 0 ||
        !Number.isSafeInteger(earnedPoints) ||
        earnedPoints < 0
      )
        continue;
      manualByWeek.set(weekStartAt, {
        weekStartAt,
        earnedPoints,
        observedAt: Number.isSafeInteger(observedAt) && observedAt > 0 ? observedAt : weekStartAt
      });
    }
    return {
      guildId: String(source.guildId || "").slice(0, 160),
      lastObservation: normalizeObservation(source.lastObservation),
      weeks: Array.from(byWeek.values())
        .sort((left, right) => left.weekStartAt - right.weekStartAt)
        .slice(-104),
      manualWeeks: Array.from(manualByWeek.values())
        .sort((left, right) => left.weekStartAt - right.weekStartAt)
        .slice(-104)
    };
  }

  function migrateLegacyGuildPointManualWeeks(value, schemaVersion, firstTrialStartAt) {
    const normalized = normalizeGuildPointHistory(value);
    if (Number(schemaVersion) >= 7) return normalized;
    const firstTrial = Number(firstTrialStartAt);
    if (!Number.isSafeInteger(firstTrial) || firstTrial <= 0) return normalized;
    const currentWeekStarts = new Set(
      normalized.manualWeeks
        .filter((record) => (record.weekStartAt - firstTrial) % GUILD_POINT_WEEK_MS === 0)
        .map((record) => record.weekStartAt)
    );
    const manualWeeks = normalized.manualWeeks.flatMap((record) => {
      const ordinal = (record.weekStartAt - LEGACY_GUILD_TRIAL_FIRST_START_AT) / GUILD_POINT_WEEK_MS;
      if (!Number.isInteger(ordinal) || ordinal < 0) return [record];
      const weekStartAt = firstTrial + ordinal * GUILD_POINT_WEEK_MS;
      return currentWeekStarts.has(weekStartAt) ? [] : [{ ...record, weekStartAt }];
    });
    return normalizeGuildPointHistory({ ...normalized, manualWeeks });
  }

  function normalizeGuildPointSnapshot(value) {
    if (!value || typeof value !== "object") return null;
    const lifetimePoints = Number(value.lifetimePoints);
    const availablePoints = Number(value.availablePoints);
    const currentWeekPoints =
      value.currentWeekPoints === null || value.currentWeekPoints === undefined ? NaN : Number(value.currentWeekPoints);
    const weekStartAt = Number(value.weekStartAt);
    const observedAt = Number(value.observedAt);
    if (
      !Number.isSafeInteger(lifetimePoints) ||
      lifetimePoints < 0 ||
      !Number.isSafeInteger(availablePoints) ||
      availablePoints < 0 ||
      !Number.isSafeInteger(weekStartAt) ||
      weekStartAt <= 0 ||
      !Number.isSafeInteger(observedAt) ||
      observedAt <= 0
    )
      return null;
    return {
      guildId: String(value.guildId || "").slice(0, 160),
      lifetimePoints,
      availablePoints,
      currentWeekPoints: Number.isSafeInteger(currentWeekPoints) && currentWeekPoints >= 0 ? currentWeekPoints : null,
      weekStartAt,
      observedAt
    };
  }

  function guildPointStateFromSnapshot(value, now = Date.now()) {
    const snapshot = normalizeGuildPointSnapshot(value);
    if (!snapshot)
      return {
        guildPointSummary: null,
        guildWeekStartAt: null,
        guildPointSummaryObservedAt: null,
        guildPointSummaryCached: false
      };
    const { weekStartAt, observedAt, currentWeekPoints, ...summary } = snapshot;
    return {
      guildPointSummary: {
        ...summary,
        ...(Number.isSafeInteger(currentWeekPoints) && now >= weekStartAt && now < weekStartAt + GUILD_POINT_WEEK_MS
          ? { currentWeekPoints }
          : {})
      },
      guildWeekStartAt: weekStartAt,
      guildPointSummaryObservedAt: observedAt,
      guildPointSummaryCached: true
    };
  }

  function normalizeTrialDisplay(value) {
    return displayApi.normalize(value);
  }

  function createPluginStorage(options) {
    const { storage, location, config, buildingDataApi, marketDataApi, trialHistoryApi } = options;
    const creditHrids = new Set(config.CREDIT_TYPES.map(([hrid]) => hrid));

    function guildBuildingPlannerStorageKey() {
      let characterId = "default";
      try {
        characterId = new URL(location.href).searchParams.get("characterId") || characterId;
      } catch (_) {
        // A per-host fallback still prevents plans from crossing game regions.
      }
      const hostname = (location && location.hostname) || "game";
      return `${config.GUILD_BUILDING_PLAN_STORAGE_PREFIX}:${hostname}:${characterId}`;
    }

    function trialHistoryPrefix() {
      return `${config.TRIAL_HISTORY_STORAGE_PREFIX}:${guildBuildingPlannerStorageKey()}:`;
    }

    function trialDisplayKey() {
      return `${config.TRIAL_DISPLAY_STORAGE_PREFIX}:${guildBuildingPlannerStorageKey()}`;
    }

    function loadTrialDisplay() {
      try {
        return normalizeTrialDisplay(JSON.parse(storage.getItem(trialDisplayKey())));
      } catch (_) {
        return normalizeTrialDisplay(null);
      }
    }

    function saveTrialDisplay(value) {
      try {
        storage.setItem(trialDisplayKey(), JSON.stringify(normalizeTrialDisplay(value)));
        return true;
      } catch (_) {
        return false;
      }
    }

    function loadTrialRankingOrder() {
      try {
        return displayApi.normalizeRankingOrder(JSON.parse(storage.getItem(`${trialDisplayKey()}:ranking-order`)));
      } catch (_) {
        return displayApi.normalizeRankingOrder(null);
      }
    }

    function saveTrialRankingOrder(value) {
      try {
        storage.setItem(`${trialDisplayKey()}:ranking-order`, JSON.stringify(displayApi.normalizeRankingOrder(value)));
        return true;
      } catch (_) {
        return false;
      }
    }

    function loadTrialHistory() {
      const records = [];
      let failed = false;
      try {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (!key || !key.startsWith(trialHistoryPrefix())) continue;
          try {
            const record = trialHistoryApi.normalizeSnapshot(JSON.parse(storage.getItem(key)));
            if (trialHistoryApi.validSnapshot(record)) records.push(record);
            else failed = true;
          } catch (_) {
            failed = true;
          }
        }
      } catch (_) {
        failed = true;
      }
      return {
        records: records.sort(trialHistoryApi.compareSnapshots),
        failed
      };
    }

    function importTrialHistory(incoming) {
      const written = [];
      let duplicates = 0;
      let conflicts = 0;
      try {
        const validated = trialHistoryApi.parseImport(JSON.stringify({ schemaVersion: 2, records: incoming }));
        for (const record of validated) {
          const key = trialHistoryPrefix() + encodeURIComponent(record.key);
          const previous = storage.getItem(key);
          if (previous !== null) {
            let existing;
            try {
              existing = JSON.parse(previous);
            } catch (_) {
              existing = { key: record.key };
            }
            const status = trialHistoryApi.previewImport([record], [existing || { key: record.key }])[0].status;
            if (status === "duplicate") duplicates += 1;
            else if (status !== "dated") conflicts += 1;
            if (status !== "dated") continue;
          }
          const text = JSON.stringify(record);
          storage.setItem(key, text);
          written.push({ key, text, previous });
        }
        return {
          status: "imported",
          added: written.filter((entry) => entry.previous === null).length,
          dated: written.filter((entry) => entry.previous !== null).length,
          duplicates,
          conflicts
        };
      } catch (_) {
        let added = 0;
        let dated = 0;
        // Restore only our own writes, including the exact pre-import value
        // when enriching a date. Do not overwrite another page's newer write.
        for (const { key, text, previous } of written) {
          let retained = false;
          try {
            if (storage.getItem(key) === text) {
              if (previous === null) storage.removeItem(key);
              else storage.setItem(key, previous);
            }
            retained = storage.getItem(key) !== previous;
          } catch (_) {
            retained = true;
          }
          if (retained && previous === null) added += 1;
          else if (retained) dated += 1;
        }
        return { status: added + dated ? "partial" : "failed", added, dated, duplicates, conflicts };
      }
    }

    function saveTrialSnapshot(record) {
      try {
        if (!trialHistoryApi.validSnapshot(record)) return false;
        const key = trialHistoryPrefix() + encodeURIComponent(record.key);
        const previous = JSON.parse(storage.getItem(key) || "null");
        const members = { ...(previous?.members || {}), ...record.members };
        // One key per trial: a quota error cannot destroy any older records.
        const levels =
          previous?.memberLevels || record.memberLevels
            ? {
                memberLevels: Object.fromEntries(
                  record.rows.flatMap((row) => {
                    const level =
                      trialHistoryApi.memberLevel(previous || {}, row) ?? trialHistoryApi.memberLevel(record, row);
                    return level === null ? [] : [[row.memberKey ?? row.characterId, level]];
                  })
                )
              }
            : {};
        storage.setItem(
          key,
          JSON.stringify({
            ...trialHistoryApi.withSavedProgress(record, previous),
            members,
            ...levels,
            ...(record.weekTrials || previous?.weekTrials
              ? { weekTrials: record.weekTrials || previous.weekTrials }
              : {}),
            ...(record.membershipEvidence || previous?.membershipEvidence
              ? {
                  membershipEvidence: trialHistoryApi.mergeMembershipEvidence(
                    previous?.membershipEvidence || [],
                    record.membershipEvidence || []
                  )
                }
              : {})
          })
        );
        return true;
      } catch (_) {
        return false;
      }
    }

    function loadSavedPluginUiState() {
      const fallback = {
        collapsedCreditSections: [],
        guildTokenValuesCollapsed: false,
        guildTokenCreditHrids: [],
        autoGuildTokenBudget: null,
        shrineGuideEnabled: false,
        maxConversionItemUnitPrice: null,
        guildShrineAutofillExcludedBuffHrids: [],
        showConstructionView: true,
        showTrialHistoryView: true,
        sidebarDisplayName: "",
        activeView: "credit",
        panelOrder: normalizePanelOrder([], config.PANEL_VIEWS, config.DEFAULT_PANEL_ORDER),
        targetCredit: config.DEFAULT_TARGET_CREDIT,
        upgradePlans: []
      };
      try {
        const raw = storage && storage.getItem(config.UI_STATE_STORAGE_KEY);
        if (!raw) return fallback;
        const stored = JSON.parse(raw);
        if (!stored || typeof stored !== "object") return fallback;
        const collapsedCreditSections = Array.isArray(stored.collapsedCreditSections)
          ? Array.from(new Set(stored.collapsedCreditSections.filter((hrid) => creditHrids.has(hrid))))
          : [];
        const upgradePlans = Array.isArray(stored.upgradePlans)
          ? stored.upgradePlans
              .filter(
                (plan) =>
                  plan &&
                  typeof plan.guildBuffHrid === "string" &&
                  Number.isSafeInteger(plan.startLevel) &&
                  Number.isSafeInteger(plan.targetLevel)
              )
              .map((plan) => ({
                guildBuffHrid: plan.guildBuffHrid,
                startLevel: plan.startLevel,
                targetLevel: plan.targetLevel,
                ...(plan.collapsed === true ? { collapsed: true } : {})
              }))
          : [];
        const targetCredit = Number(stored.targetCredit);
        const guildTokenCreditHrids = Array.isArray(stored.guildTokenCreditHrids)
          ? Array.from(new Set(stored.guildTokenCreditHrids.filter((hrid) => creditHrids.has(hrid))))
          : stored.useGuildTokensForMissingCredits === true
            ? Array.from(creditHrids)
            : [];
        const autoGuildTokenBudgetValue = Number(stored.autoGuildTokenBudget);
        const autoGuildTokenBudget =
          stored.autoGuildTokenBudget === null || stored.autoGuildTokenBudget === undefined
            ? null
            : Number.isSafeInteger(autoGuildTokenBudgetValue) && autoGuildTokenBudgetValue >= 0
              ? autoGuildTokenBudgetValue
              : null;
        const maxConversionItemUnitPriceValue = Number(stored.maxConversionItemUnitPrice);
        const maxConversionItemUnitPrice =
          stored.maxConversionItemUnitPrice !== null &&
          stored.maxConversionItemUnitPrice !== undefined &&
          Number.isSafeInteger(maxConversionItemUnitPriceValue) &&
          maxConversionItemUnitPriceValue > 0
            ? maxConversionItemUnitPriceValue
            : null;
        return {
          collapsedCreditSections,
          guildTokenValuesCollapsed: stored.guildTokenValuesCollapsed === true,
          guildTokenCreditHrids,
          autoGuildTokenBudget,
          shrineGuideEnabled: stored.shrineGuideEnabled === true,
          maxConversionItemUnitPrice,
          guildShrineAutofillExcludedBuffHrids: normalizeGuildShrineAutofillExcludedBuffHrids(
            stored.guildShrineAutofillExcludedBuffHrids
          ),
          showConstructionView: stored.showConstructionView !== false,
          showTrialHistoryView: stored.showTrialHistoryView !== false,
          sidebarDisplayName: normalizeSidebarDisplayName(stored.sidebarDisplayName),
          activeView: normalizePanelView(stored.activeView, config.PANEL_VIEWS),
          panelOrder: normalizePanelOrder(stored.panelOrder, config.PANEL_VIEWS, config.DEFAULT_PANEL_ORDER),
          targetCredit: Number.isSafeInteger(targetCredit) && targetCredit > 0 ? targetCredit : fallback.targetCredit,
          upgradePlans
        };
      } catch (_) {
        return fallback;
      }
    }

    function loadSavedGuildBuildingPlannerState() {
      const fallback = {
        plans: [],
        manualGuildPoints: null,
        guildPointSettings: { guildPointForecastWeeks: 6, guildPointPlanningWeeks: 0 },
        category: "all",
        guildPointHistory: normalizeGuildPointHistory(null),
        guildPointSnapshot: null
      };
      try {
        const raw = storage && storage.getItem(guildBuildingPlannerStorageKey());
        if (!raw) return fallback;
        const stored = JSON.parse(raw);
        if (!stored || typeof stored !== "object") return fallback;
        const definitions = new Map(buildingDataApi.definitions().map((entry) => [entry.hrid, entry]));
        const seenBuildingHrids = new Set();
        const plans = Array.isArray(stored.plans)
          ? stored.plans.flatMap((plan) => {
              const definition = plan && definitions.get(plan.buildingHrid);
              const startLevel = Number(plan && plan.startLevel);
              const targetLevel = Number(plan && plan.targetLevel);
              if (
                !definition ||
                !Number.isSafeInteger(startLevel) ||
                !Number.isSafeInteger(targetLevel) ||
                startLevel < 0 ||
                targetLevel <= startLevel ||
                targetLevel > definition.maxLevel
              )
                return [];
              if (seenBuildingHrids.has(definition.hrid)) return [];
              seenBuildingHrids.add(definition.hrid);
              return [{ buildingHrid: definition.hrid, startLevel, targetLevel }];
            })
          : [];
        const manualGuildPointsValue = Number(stored.manualGuildPoints);
        const manualGuildPoints =
          stored.manualGuildPoints === null || stored.manualGuildPoints === undefined || stored.manualGuildPoints === ""
            ? null
            : Number.isSafeInteger(manualGuildPointsValue) && manualGuildPointsValue >= 0
              ? manualGuildPointsValue
              : null;
        const category = ["all", "core", "life", "combat", "shrine"].includes(stored.category)
          ? stored.category
          : "all";
        const guildPointForecastWeeksValue = Number(stored.guildPointForecastWeeks);
        const guildPointPlanningWeeksValue = Number(stored.guildPointPlanningWeeks);
        return {
          plans,
          manualGuildPoints,
          guildPointSettings: {
            guildPointForecastWeeks:
              Number.isSafeInteger(guildPointForecastWeeksValue) &&
              guildPointForecastWeeksValue >= 2 &&
              guildPointForecastWeeksValue <= 12
                ? guildPointForecastWeeksValue
                : 6,
            guildPointPlanningWeeks:
              Number.isSafeInteger(guildPointPlanningWeeksValue) &&
              guildPointPlanningWeeksValue >= 0 &&
              guildPointPlanningWeeksValue <= 12
                ? guildPointPlanningWeeksValue
                : 0
          },
          category,
          guildPointHistory: migrateLegacyGuildPointManualWeeks(
            stored.guildPointHistory,
            stored.schemaVersion,
            config.GUILD_TRIAL_FIRST_START_AT
          ),
          // Older snapshots may have copied the available balance into weekly
          // progress. Preserve all other data and wait for a fresh weekly read.
          guildPointSnapshot: normalizeGuildPointSnapshot(
            stored.guildPointSnapshot && !(Number(stored.schemaVersion) >= 7)
              ? { ...stored.guildPointSnapshot, currentWeekPoints: null }
              : stored.guildPointSnapshot
          )
        };
      } catch (_) {
        return fallback;
      }
    }

    function persistGuildBuildingPlannerState(state) {
      try {
        storage &&
          storage.setItem(
            guildBuildingPlannerStorageKey(),
            JSON.stringify({
              schemaVersion: GUILD_BUILDING_PLANNER_SCHEMA_VERSION,
              rulesVersion: buildingDataApi.RULES_VERSION,
              manualGuildPoints: state.manualGuildPoints,
              guildPointForecastWeeks: state.guildPointForecastWeeks,
              guildPointPlanningWeeks: state.guildPointPlanningWeeks,
              category: state.buildingCategory,
              guildPointHistory: normalizeGuildPointHistory(state.guildPointHistory),
              guildPointSnapshot: normalizeGuildPointSnapshot({
                ...state.guildPointSummary,
                weekStartAt: state.guildWeekStartAt,
                observedAt: state.guildPointSummaryObservedAt
              }),
              plans: state.buildingPlans.map((plan) => ({
                buildingHrid: plan.buildingHrid,
                startLevel: plan.startLevel,
                targetLevel: plan.targetLevel
              }))
            })
          );
      } catch (_) {
        // Keep the current page state when browser storage is unavailable.
      }
    }

    function persistPluginUiState(state) {
      try {
        if (!storage || typeof storage.setItem !== "function") return false;
        const upgradePlans = state.upgradePlans.map((plan) => ({
          guildBuffHrid: plan.guildBuffHrid,
          startLevel: plan.startLevel,
          targetLevel: plan.targetLevel,
          ...(plan.collapsed === true ? { collapsed: true } : {})
        }));
        storage.setItem(
          config.UI_STATE_STORAGE_KEY,
          JSON.stringify({
            collapsedCreditSections: Array.from(state.collapsedCreditSections),
            guildTokenValuesCollapsed: state.guildTokenValuesCollapsed,
            guildTokenCreditHrids: Array.from(state.guildTokenCreditHrids),
            autoGuildTokenBudget: state.autoGuildTokenBudget,
            shrineGuideEnabled: state.shrineGuideEnabled,
            maxConversionItemUnitPrice:
              Number.isSafeInteger(state.maxConversionItemUnitPrice) && state.maxConversionItemUnitPrice > 0
                ? state.maxConversionItemUnitPrice
                : null,
            guildShrineAutofillExcludedBuffHrids: normalizeGuildShrineAutofillExcludedBuffHrids(
              state.guildShrineAutofillExcludedBuffHrids
            ),
            showConstructionView: state.showConstructionView === true,
            showTrialHistoryView: state.showTrialHistoryView === true,
            sidebarDisplayName: normalizeSidebarDisplayName(state.sidebarDisplayName),
            activeView: state.activeView,
            panelOrder: normalizePanelOrder(state.panelOrder, config.PANEL_VIEWS, config.DEFAULT_PANEL_ORDER),
            useGuildTokensForMissingCredits: config.CREDIT_TYPES.every(([hrid]) =>
              state.guildTokenCreditHrids.has(hrid)
            ),
            targetCredit: state.targetCredit,
            upgradePlans
          })
        );
        return true;
      } catch (_) {
        // Keep the current page state when browser storage is unavailable.
        return false;
      }
    }

    function loadSavedLiveMarketData() {
      try {
        const raw = storage && storage.getItem(config.MARKET_LIVE_STORAGE_KEY);
        return marketDataApi.restoreLiveMarketData(raw);
      } catch (_) {
        return { liveData: Object.create(null), revision: 0, valid: false };
      }
    }

    function persistLiveMarketData(liveData, revision) {
      try {
        if (!storage) return;
        if (!Object.keys(liveData).length) {
          storage.removeItem(config.MARKET_LIVE_STORAGE_KEY);
          return;
        }
        const cache = marketDataApi.serializeLiveMarketData(liveData, { revision });
        storage.setItem(config.MARKET_LIVE_STORAGE_KEY, JSON.stringify(cache));
      } catch (_) {
        // A storage quota or privacy restriction must not interrupt the game.
      }
    }

    function loadSavedMarketSnapshot() {
      const fallback = { snapshot: null, fetchedAt: 0 };
      try {
        const raw = storage && storage.getItem(config.MARKETPLACE_SNAPSHOT_STORAGE_KEY);
        if (!raw) return fallback;
        const stored = JSON.parse(raw);
        const fetchedAt = Number(stored && stored.fetchedAt);
        const timestamp = marketDataApi.normalizeMarketTimestamp(stored && stored.timestamp);
        const marketData = marketDataApi.sanitizeMarketData(stored && stored.marketData);
        if (
          !stored ||
          stored.schemaVersion !== 1 ||
          !Number.isSafeInteger(fetchedAt) ||
          fetchedAt <= 0 ||
          timestamp <= 0 ||
          !Object.keys(marketData).length
        )
          return fallback;
        return { snapshot: { timestamp, marketData }, fetchedAt };
      } catch (_) {
        return fallback;
      }
    }

    function persistMarketSnapshot(snapshot, fetchedAt) {
      try {
        if (!storage || typeof storage.setItem !== "function") return false;
        const timestamp = marketDataApi.normalizeMarketTimestamp(snapshot && snapshot.timestamp);
        const marketData = marketDataApi.sanitizeMarketData(snapshot && snapshot.marketData);
        const normalizedFetchedAt = Number(fetchedAt);
        if (
          timestamp <= 0 ||
          !Object.keys(marketData).length ||
          !Number.isSafeInteger(normalizedFetchedAt) ||
          normalizedFetchedAt <= 0
        )
          return false;
        storage.setItem(
          config.MARKETPLACE_SNAPSHOT_STORAGE_KEY,
          JSON.stringify({ schemaVersion: 1, fetchedAt: normalizedFetchedAt, timestamp, marketData })
        );
        return true;
      } catch (_) {
        return false;
      }
    }

    function loadMarketplaceRequestState() {
      const forbiddenUntilByOrigin = Object.create(null);
      try {
        const raw = storage && storage.getItem(config.MARKETPLACE_REQUEST_STATE_STORAGE_KEY);
        if (!raw) return { forbiddenUntilByOrigin };
        const stored = JSON.parse(raw);
        if (!stored || stored.schemaVersion !== 1 || !stored.forbiddenUntilByOrigin) {
          return { forbiddenUntilByOrigin };
        }
        for (const origin of config.MARKETPLACE_SNAPSHOT_ORIGINS) {
          const forbiddenUntil = Number(stored.forbiddenUntilByOrigin[origin]);
          if (Number.isSafeInteger(forbiddenUntil) && forbiddenUntil > 0) {
            forbiddenUntilByOrigin[origin] = forbiddenUntil;
          }
        }
      } catch (_) {
        // Invalid request metadata should never block a new request.
      }
      return { forbiddenUntilByOrigin };
    }

    function persistMarketplaceRequestState(requestState) {
      try {
        if (!storage || typeof storage.setItem !== "function") return false;
        const forbiddenUntilByOrigin = Object.create(null);
        for (const origin of config.MARKETPLACE_SNAPSHOT_ORIGINS) {
          const forbiddenUntil = Number(
            requestState && requestState.forbiddenUntilByOrigin && requestState.forbiddenUntilByOrigin[origin]
          );
          if (Number.isSafeInteger(forbiddenUntil) && forbiddenUntil > 0) {
            forbiddenUntilByOrigin[origin] = forbiddenUntil;
          }
        }
        if (!Object.keys(forbiddenUntilByOrigin).length) {
          storage.removeItem(config.MARKETPLACE_REQUEST_STATE_STORAGE_KEY);
          return true;
        }
        storage.setItem(
          config.MARKETPLACE_REQUEST_STATE_STORAGE_KEY,
          JSON.stringify({ schemaVersion: 1, forbiddenUntilByOrigin })
        );
        return true;
      } catch (_) {
        return false;
      }
    }

    function loadPriceReference() {
      try {
        const saved = storage && storage.getItem(config.PRICE_REFERENCE_STORAGE_KEY);
        return config.PRICE_REFERENCES[saved] ? saved : "a";
      } catch (_) {
        return "a";
      }
    }

    function persistPriceReference(reference) {
      try {
        storage && storage.setItem(config.PRICE_REFERENCE_STORAGE_KEY, reference);
      } catch (_) {
        // Keep the current page choice even when browser storage is unavailable.
      }
    }

    return {
      guildBuildingPlannerStorageKey,
      loadTrialHistory,
      loadTrialDisplay,
      saveTrialDisplay,
      loadTrialRankingOrder,
      saveTrialRankingOrder,
      saveTrialSnapshot,
      importTrialHistory,
      loadSavedPluginUiState,
      loadSavedGuildBuildingPlannerState,
      persistGuildBuildingPlannerState,
      persistPluginUiState,
      loadSavedLiveMarketData,
      persistLiveMarketData,
      loadSavedMarketSnapshot,
      persistMarketSnapshot,
      loadMarketplaceRequestState,
      persistMarketplaceRequestState,
      loadPriceReference,
      persistPriceReference
    };
  }

  return {
    normalizeSidebarDisplayName,
    normalizeTrialDisplay,
    normalizePanelView,
    normalizePanelOrder,
    normalizeGuildPointHistory,
    guildPointStateFromSnapshot,
    normalizeGuildShrineAutofillExcludedBuffHrids,
    createPluginStorage
  };
});


// SOURCE: src/runtime/scheduler.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildCreditScheduler = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createDebouncedTask(options) {
    const { task, delay = 0, setTimer = setTimeout, clearTimer = clearTimeout } = options;
    let timer = null;
    let latestArgs = [];
    let disposed = false;

    function cancel() {
      if (timer === null) return;
      clearTimer(timer);
      timer = null;
    }

    function schedule(...args) {
      if (disposed) return false;
      latestArgs = args;
      cancel();
      timer = setTimer(() => {
        timer = null;
        task(...latestArgs);
      }, delay);
      return true;
    }

    function dispose() {
      disposed = true;
      latestArgs = [];
      cancel();
    }

    return {
      schedule,
      cancel,
      dispose,
      pending: () => timer !== null,
      disposed: () => disposed
    };
  }

  function createFrameTask(options) {
    const { task, requestFrame, cancelFrame, merge = (_, next) => next } = options;
    let frame = null;
    let payload;
    let disposed = false;

    function cancel() {
      if (frame === null) return;
      if (typeof cancelFrame === "function") cancelFrame(frame);
      frame = null;
      payload = undefined;
    }

    function schedule(nextPayload) {
      if (disposed) return false;
      payload = frame === null ? nextPayload : merge(payload, nextPayload);
      if (frame !== null) return true;
      frame = requestFrame(() => {
        frame = null;
        const currentPayload = payload;
        payload = undefined;
        task(currentPayload);
      });
      return true;
    }

    function dispose() {
      disposed = true;
      cancel();
    }

    return {
      schedule,
      cancel,
      dispose,
      pending: () => frame !== null,
      disposed: () => disposed
    };
  }

  return { createDebouncedTask, createFrameTask };
});


// SOURCE: src/runtime/game-state.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildCreditGameState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function objectCollection(candidate) {
    return Boolean(candidate && (Array.isArray(candidate) || typeof candidate === "object"));
  }

  function guildShrineLevelRecordKey(record, fallbackKey) {
    if (record && typeof record === "object") {
      const explicitKey = record.guildShrineHrid || record.shrineHrid || record.guildBuildingHrid || record.hrid;
      if (typeof explicitKey === "string" && explicitKey) return explicitKey;
    }
    return String(fallbackKey || "");
  }

  function mergeGuildShrineLevels(previous, incoming) {
    if (!incoming || typeof incoming !== "object") return previous;
    const merged = Object.create(null);
    const append = (source) => {
      const entries = Array.isArray(source)
        ? source.map((record, index) => [guildShrineLevelRecordKey(record, index), record])
        : Object.entries(source || {});
      for (const [fallbackKey, record] of entries) {
        const key = guildShrineLevelRecordKey(record, fallbackKey);
        if (key) merged[key] = record;
      }
    };
    append(previous);
    append(incoming);
    return merged;
  }

  const GUILD_BUILDING_LEVEL_FIELDS = [
    "guildBuildingMap",
    "guildBuildingDict",
    "guildBuildings",
    "guildBuildingLevelMap",
    "guildBuildingLevelDict",
    "guildBuildingLevels"
  ];

  function guildWeekStartTimestamp(value) {
    const numeric = Number(value);
    if (Number.isSafeInteger(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }

  function createGameStateAdapter(state) {
    let currentWeekGuildPoints = Number.isSafeInteger(state.guildPointSummary?.currentWeekPoints)
      ? state.guildPointSummary.currentWeekPoints
      : undefined;

    function setItemDetails(candidate) {
      if (!objectCollection(candidate)) return false;
      if (state.itemDetails !== candidate) state.conversionCache.clear();
      state.itemDetails = candidate;
      return true;
    }

    function setGuildBuffDetails(candidate) {
      if (!objectCollection(candidate)) return false;
      state.guildBuffDetails = candidate;
      return true;
    }

    function setGuildBuffLevels(candidate) {
      if (!objectCollection(candidate)) return false;
      state.guildBuffLevels = candidate;
      return true;
    }

    function setMergedStateField(field, candidate) {
      if (!objectCollection(candidate)) return false;
      state[field] = mergeGuildShrineLevels(state[field], candidate);
      return true;
    }

    function setGuildShrineLevels(candidate) {
      return setMergedStateField("guildShrineLevels", candidate);
    }

    function setGuildShrineDetails(candidate) {
      return setMergedStateField("guildShrineDetails", candidate);
    }

    function setGuildBuildingLevels(candidate) {
      return setMergedStateField("guildBuildingLevels", candidate);
    }

    function setGuildBuildingDetails(candidate) {
      return setMergedStateField("guildBuildingDetails", candidate);
    }

    function setGuildPointSummaryFrom(source) {
      if (!source || typeof source !== "object") return false;
      const lifetimePoints = Number(source.lifetimeGuildPoints ?? source.lifetimePoints);
      const availablePoints = Number(source.guildPoints ?? source.availablePoints);
      if (
        !Number.isSafeInteger(lifetimePoints) ||
        lifetimePoints < 0 ||
        !Number.isSafeInteger(availablePoints) ||
        availablePoints < 0
      )
        return false;
      const previous = state.guildPointSummary;
      const guildId = String(source.guildID || source.guildId || source.id || (previous && previous.guildId) || "");
      const guildChanged = previous?.guildId && guildId && previous.guildId !== guildId;
      const sourceWeekStartAt = guildWeekStartTimestamp(source.currentWeekStartAt);
      if (!guildChanged && sourceWeekStartAt && state.guildWeekStartAt && sourceWeekStartAt < state.guildWeekStartAt)
        return false;
      if (guildChanged) {
        currentWeekGuildPoints = undefined;
        state.guildWeekStartAt = null;
      }
      const weekChanged = setGuildWeekStartAtFrom(source);
      state.guildPointSummaryObservedAt = Date.now();
      state.guildPointSummaryCached = false;
      if (
        previous &&
        previous.guildId === guildId &&
        previous.lifetimePoints === lifetimePoints &&
        previous.availablePoints === availablePoints &&
        previous.currentWeekPoints === currentWeekGuildPoints
      )
        return weekChanged;
      state.guildPointSummary = {
        guildId,
        lifetimePoints,
        availablePoints,
        ...(Number.isSafeInteger(currentWeekGuildPoints) ? { currentWeekPoints: currentWeekGuildPoints } : {})
      };
      return true;
    }

    function setGuildWeekStartAtFrom(source) {
      if (!source || typeof source !== "object") return false;
      const weekStartAt = guildWeekStartTimestamp(source.currentWeekStartAt);
      if (weekStartAt && state.guildWeekStartAt && weekStartAt < state.guildWeekStartAt) return false;
      // Only explicitly weekly fields identify trial progress. guildPoints is
      // the spendable balance, even when the same object contains a week date.
      const rawPoints = source.currentWeekGuildPoints ?? source.currentWeekPoints ?? source.weeklyGuildPoints;
      const sourceCurrentWeekPoints =
        typeof rawPoints === "number" || (typeof rawPoints === "string" && rawPoints.trim()) ? Number(rawPoints) : NaN;
      let changed = false;
      if (weekStartAt && weekStartAt !== state.guildWeekStartAt) {
        state.guildWeekStartAt = weekStartAt;
        currentWeekGuildPoints = undefined;
        if (state.guildPointSummary) {
          state.guildPointSummary = { ...state.guildPointSummary };
          delete state.guildPointSummary.currentWeekPoints;
        }
        changed = true;
      }
      if (Number.isSafeInteger(sourceCurrentWeekPoints) && sourceCurrentWeekPoints >= 0) {
        currentWeekGuildPoints = sourceCurrentWeekPoints;
        if (state.guildPointSummary && state.guildPointSummary.currentWeekPoints !== currentWeekGuildPoints) {
          state.guildPointSummary = { ...state.guildPointSummary, currentWeekPoints: currentWeekGuildPoints };
          changed = true;
        }
      }
      return changed;
    }

    function setCharacterItems(candidate) {
      if (!Array.isArray(candidate)) return false;
      state.characterItems = candidate;
      return true;
    }

    function setGuildBuffLevelsFrom(source) {
      if (!source || typeof source !== "object") return false;
      return setGuildBuffLevels(
        source.characterGuildBuffMap ||
          source.characterGuildBuffDict ||
          source.characterGuildBuffs ||
          source.characterGuildBuffLevelMap ||
          source.characterGuildBuffLevelDict ||
          source.guildBuffLevelMap ||
          source.guildBuffLevelDict ||
          source.guildBuffLevels ||
          source.guildBuffMap ||
          source.guildBuffDict
      );
    }

    function applyCandidates(source, fields, setter) {
      if (!source || typeof source !== "object") return false;
      let updated = false;
      for (const field of fields) updated = setter(source[field]) || updated;
      return updated;
    }

    function setGuildShrineLevelsFrom(source) {
      return applyCandidates(
        source,
        [
          "guildShrineMap",
          "guildShrineDict",
          "guildShrines",
          "guildShrineLevelMap",
          "guildShrineLevelDict",
          "guildShrineLevels",
          "guildBuildingMap",
          "guildBuildingDict",
          "guildBuildings",
          "guildBuildingLevelMap",
          "guildBuildingLevelDict",
          "guildBuildingLevels"
        ],
        setGuildShrineLevels
      );
    }

    function setGuildShrineDetailsFrom(source) {
      return applyCandidates(
        source,
        [
          "guildShrineDetailMap",
          "guildShrineDetailDict",
          "guildShrineDetails",
          "guildBuildingDetailMap",
          "guildBuildingDetailDict",
          "guildBuildingDetails"
        ],
        setGuildShrineDetails
      );
    }

    function setGuildBuildingLevelsFrom(source) {
      return applyCandidates(source, GUILD_BUILDING_LEVEL_FIELDS, setGuildBuildingLevels);
    }

    function seedCompleteGuildBuildingLevelsFrom(source) {
      if (!source || typeof source !== "object") return false;
      let snapshot = null;
      let found = false;
      for (const field of GUILD_BUILDING_LEVEL_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(source, field) || !objectCollection(source[field])) continue;
        snapshot = mergeGuildShrineLevels(snapshot, source[field]);
        found = true;
      }
      if (!found) return false;
      // Initialization data is the complete baseline; current-session frames
      // already merged into state take precedence when the snapshot is older.
      state.guildBuildingLevels = mergeGuildShrineLevels(snapshot, state.guildBuildingLevels);
      state.guildBuildingLevelsComplete = true;
      return true;
    }

    function setGuildBuildingDetailsFrom(source) {
      return applyCandidates(
        source,
        ["guildBuildingDetailMap", "guildBuildingDetailDict", "guildBuildingDetails"],
        setGuildBuildingDetails
      );
    }

    return {
      setItemDetails,
      setGuildBuffDetails,
      setGuildBuffLevels,
      setGuildShrineLevels,
      setGuildShrineDetails,
      setGuildBuildingLevels,
      setGuildBuildingDetails,
      setGuildPointSummaryFrom,
      setGuildWeekStartAtFrom,
      setCharacterItems,
      setGuildBuffLevelsFrom,
      setGuildShrineLevelsFrom,
      setGuildShrineDetailsFrom,
      setGuildBuildingLevelsFrom,
      seedCompleteGuildBuildingLevelsFrom,
      setGuildBuildingDetailsFrom
    };
  }

  return { guildShrineLevelRecordKey, mergeGuildShrineLevels, guildWeekStartTimestamp, createGameStateAdapter };
});


// SOURCE: src/runtime/game-data.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildCreditGameData = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function marketplaceSnapshotUrls(location, snapshotOrigins, snapshotPath) {
    const path =
      typeof snapshotPath === "string" && snapshotPath.startsWith("/") ? snapshotPath : "/game_data/marketplace.json";
    const currentOrigin = String((location && location.origin) || "").replace(/\/$/, "");
    if (!currentOrigin) return [path];

    const origins = Array.from(
      new Set(
        (Array.isArray(snapshotOrigins) ? snapshotOrigins : [])
          .map((origin) => String(origin || "").replace(/\/$/, ""))
          .filter(Boolean)
      )
    );
    if (!origins.includes(currentOrigin)) return [`${currentOrigin}${path}`];
    return [currentOrigin, ...origins.filter((origin) => origin !== currentOrigin)].map((origin) => `${origin}${path}`);
  }

  function createGameData(dependencies) {
    const {
      state,
      pageWindow,
      document,
      marketDataApi,
      core,
      setItemDetails,
      setGuildBuffDetails,
      setCharacterItems,
      setGuildBuffLevelsFrom,
      setGuildShrineLevelsFrom,
      setGuildShrineDetailsFrom,
      setGuildBuildingLevelsFrom,
      seedCompleteGuildBuildingLevelsFrom,
      setGuildBuildingDetailsFrom,
      setGuildPointSummaryFrom,
      setGuildWeekStartAtFrom,
      persistLiveMarketData,
      scheduleMarketDataRefresh,
      scheduleInventoryDataRefresh,
      scheduleGuildDataRefresh,
      pluginStorage,
      config,
      resolveItemName,
      CREDIT_TYPES,
      fetchImpl,
      now
    } = dependencies;
    const persistMarketSnapshot =
      dependencies.persistMarketSnapshot || (pluginStorage && pluginStorage.persistMarketSnapshot);
    const persistMarketplaceRequestState =
      dependencies.persistMarketplaceRequestState || (pluginStorage && pluginStorage.persistMarketplaceRequestState);
    const runtimeConfig = config || dependencies;
    const {
      MARKETPLACE_SNAPSHOT_PATH,
      MARKETPLACE_SNAPSHOT_ORIGINS,
      MARKETPLACE_SNAPSHOT_MAX_AGE_MS,
      MARKETPLACE_SNAPSHOT_REFRESH_COOLDOWN_MS,
      MARKETPLACE_SNAPSHOT_FORBIDDEN_BACKOFF_MS
    } = runtimeConfig;
    let snapshotLoadPromise = null;

    function scanGuildPointFields(rootValue, maxDepth = 8, maxScanned = 400) {
      const pending = [{ value: rootValue, depth: 0 }];
      const visited = new Set();
      let scanned = 0;
      let found = false;
      while (pending.length && scanned < maxScanned) {
        const { value, depth } = pending.pop();
        if (!value || typeof value !== "object" || visited.has(value) || depth > maxDepth) continue;
        visited.add(value);
        scanned += 1;
        found = setGuildPointSummaryFrom(value) || found;
        found = setGuildWeekStartAtFrom(value) || found;
        for (const child of Object.values(value)) pending.push({ value: child, depth: depth + 1 });
      }
      return found;
    }

    function decompressFromUtf16(compressed) {
      if (compressed == null) return "";
      if (compressed === "") return null;
      const dictionary = [0, 1, 2];
      let next;
      let enlargeIn = 4;
      let dictionarySize = 4;
      let numBits = 3;
      let entry = "";
      const result = [];
      let dataValue = compressed.charCodeAt(0) - 32;
      let dataPosition = 16384;
      let dataIndex = 1;

      const readBits = (count) => {
        let value = 0;
        let bit = 1;
        for (let power = 1, maxPower = 1 << count; power !== maxPower; power <<= 1) {
          const residue = dataValue & dataPosition;
          dataPosition >>= 1;
          if (dataPosition === 0) {
            dataPosition = 16384;
            dataValue = dataIndex < compressed.length ? compressed.charCodeAt(dataIndex) - 32 : 0;
            dataIndex += 1;
          }
          if (residue > 0) value |= bit;
          bit <<= 1;
        }
        return value;
      };

      const firstToken = readBits(2);
      if (firstToken === 0) entry = String.fromCharCode(readBits(8));
      else if (firstToken === 1) entry = String.fromCharCode(readBits(16));
      else return "";

      dictionary[3] = entry;
      let previous = entry;
      result.push(entry);

      while (true) {
        if (dataIndex > compressed.length) return "";
        const token = readBits(numBits);
        if (token === 0) {
          dictionary[dictionarySize] = String.fromCharCode(readBits(8));
          dictionarySize += 1;
          enlargeIn -= 1;
          next = dictionarySize - 1;
        } else if (token === 1) {
          dictionary[dictionarySize] = String.fromCharCode(readBits(16));
          dictionarySize += 1;
          enlargeIn -= 1;
          next = dictionarySize - 1;
        } else if (token === 2) {
          return result.join("");
        } else {
          next = token;
        }

        if (enlargeIn === 0) {
          enlargeIn = 1 << numBits;
          numBits += 1;
        }
        if (dictionary[next]) entry = dictionary[next];
        else if (next === dictionarySize) entry = previous + previous.charAt(0);
        else return null;

        result.push(entry);
        dictionary[dictionarySize] = previous + entry.charAt(0);
        dictionarySize += 1;
        enlargeIn -= 1;
        previous = entry;

        if (enlargeIn === 0) {
          enlargeIn = 1 << numBits;
          numBits += 1;
        }
      }
    }

    function hydrateLocalInitData() {
      if (
        state.itemDetails &&
        state.guildBuffDetails &&
        state.guildBuffLevels &&
        state.guildShrineLevels &&
        state.guildBuildingLevels &&
        state.guildBuildingLevelsComplete === true &&
        state.characterItems
      )
        return true;
      let raw;
      try {
        raw = pageWindow.localStorage && pageWindow.localStorage.getItem("initClientData");
      } catch (_) {
        return false;
      }
      if (!raw) return false;
      try {
        const decoded = decompressFromUtf16(raw);
        let data;
        try {
          data = JSON.parse(decoded || raw);
        } catch (_) {
          data = JSON.parse(raw);
        }
        // initClientData is a durable fallback and can outlive a game data update.
        // Never let it overwrite values already captured from the current session.
        const hasItems = !state.itemDetails && setItemDetails(data.itemDetailMap || data.itemDetailDict);
        const hasGuildBuffs =
          !state.guildBuffDetails && setGuildBuffDetails(data.guildBuffDetailMap || data.guildBuffDetailDict);
        const hasGuildBuffLevels =
          !state.guildBuffLevels && (setGuildBuffLevelsFrom(data) || setGuildBuffLevelsFrom(data.character));
        const hasGuildShrineLevels =
          !state.guildShrineLevels && (setGuildShrineLevelsFrom(data) || setGuildShrineLevelsFrom(data.guild));
        const hasGuildShrineDetails =
          !state.guildShrineDetails && (setGuildShrineDetailsFrom(data) || setGuildShrineDetailsFrom(data.guild));
        const hasRootGuildBuildingLevels = seedCompleteGuildBuildingLevelsFrom(data);
        const hasNestedGuildBuildingLevels = seedCompleteGuildBuildingLevelsFrom(data.guild);
        const hasGuildBuildingLevels = hasRootGuildBuildingLevels || hasNestedGuildBuildingLevels;
        const hasGuildBuildingDetails =
          !state.guildBuildingDetails && (setGuildBuildingDetailsFrom(data) || setGuildBuildingDetailsFrom(data.guild));
        const hasGuildPointData = scanGuildPointFields(data);
        const hasCharacterItems =
          !state.characterItems && setCharacterItems(data.characterItems || (data.character && data.character.items));
        return (
          hasItems ||
          hasGuildBuffs ||
          hasGuildBuffLevels ||
          hasGuildShrineLevels ||
          hasGuildShrineDetails ||
          hasGuildBuildingLevels ||
          hasGuildBuildingDetails ||
          hasGuildPointData ||
          hasCharacterItems
        );
      } catch (_) {
        return false;
      }
    }

    function extractItemDetailsFromReact() {
      if (
        state.itemDetails &&
        state.guildBuffDetails &&
        state.guildBuffLevels &&
        state.guildShrineLevels &&
        state.guildBuildingLevels &&
        state.characterItems
      )
        return true;
      const roots = [document.getElementById("root"), document.body].filter(Boolean);
      const visited = new Set();
      const stack = [];
      for (const root of roots) {
        for (const key of Object.keys(root)) {
          if (
            key.startsWith("__reactFiber$") ||
            key.startsWith("__reactContainer$") ||
            key.startsWith("__reactInternalInstance$")
          )
            stack.push(root[key]);
        }
      }
      let scanned = 0;
      let found = false;
      while (stack.length && scanned < 6000) {
        const fiber = stack.pop();
        if (!fiber || typeof fiber !== "object" || visited.has(fiber)) continue;
        visited.add(fiber);
        scanned += 1;
        const stateValue = fiber.stateNode && fiber.stateNode.state;
        const candidates = [fiber.memoizedProps, fiber.pendingProps, stateValue, fiber.memoizedState];
        for (const candidate of candidates) {
          if (!candidate || typeof candidate !== "object") continue;
          found = setItemDetails(candidate.itemDetailMap || candidate.itemDetailDict) || found;
          found = setGuildBuffDetails(candidate.guildBuffDetailMap || candidate.guildBuffDetailDict) || found;
          found = setGuildBuffLevelsFrom(candidate) || found;
          found = setGuildShrineLevelsFrom(candidate) || found;
          found = setGuildShrineDetailsFrom(candidate) || found;
          found = setGuildBuildingLevelsFrom(candidate) || found;
          found = setGuildBuildingDetailsFrom(candidate) || found;
          found = scanGuildPointFields(candidate, 2, 40) || found;
          found = setCharacterItems(candidate.characterItems) || found;
          if (
            state.itemDetails &&
            state.guildBuffDetails &&
            state.guildBuffLevels &&
            state.guildShrineLevels &&
            state.guildBuildingLevels &&
            state.guildPointSummary &&
            state.guildWeekStartAt &&
            state.characterItems
          )
            return true;
        }
        // React 18 containers point at a FiberRoot whose active tree is .current.
        if (fiber.current) stack.push(fiber.current);
        if (fiber.stateNode && fiber.stateNode.current) stack.push(fiber.stateNode.current);
        if (fiber.child) stack.push(fiber.child);
        if (fiber.sibling) stack.push(fiber.sibling);
      }
      return found;
    }

    function scanMessage(value, depth) {
      if (!value || typeof value !== "object" || depth > 8) return;
      setItemDetails(value.itemDetailMap || value.itemDetailDict);
      setGuildBuffDetails(value.guildBuffDetailMap || value.guildBuffDetailDict);
      setGuildBuffLevelsFrom(value);
      setGuildShrineLevelsFrom(value);
      setGuildShrineDetailsFrom(value);
      setGuildBuildingLevelsFrom(value);
      setGuildBuildingDetailsFrom(value);
      setGuildPointSummaryFrom(value);
      setGuildWeekStartAtFrom(value);
      setCharacterItems(value.characterItems);
      for (const child of Object.values(value)) scanMessage(child, depth + 1);
    }

    function rememberLiveMarketUpdate(update, receivedAt) {
      if (!update) return false;
      const signature = JSON.stringify(update.levels);
      const observedAt = Number(receivedAt);
      if (
        (!Number.isFinite(observedAt) || observedAt <= 0) &&
        state.marketUpdateSignatures[update.itemHrid] === signature
      )
        return false;
      state.marketUpdateSignatures[update.itemHrid] = signature;
      state.marketLiveRevision = Math.min(Number.MAX_SAFE_INTEGER, state.marketLiveRevision + 1);
      const changed = marketDataApi.applyLiveMarketUpdate(state.marketLiveData, update, {
        revision: state.marketLiveRevision,
        receivedAt: observedAt || Date.now(),
        snapshotTimestamp: state.snapshotTimestamp
      });
      if (changed) {
        persistLiveMarketData();
        scheduleMarketDataRefresh();
      }
      return changed;
    }

    function hydrateBridgeData() {
      const bridge = window.__mwiGuildCreditBridge;
      if (!bridge || typeof bridge !== "object") return false;
      let marketChanged = false;
      bridge.onMarketOrderBooksUpdated = hydrateBridgeData;
      bridge.onCharacterItemsUpdated = hydrateBridgeData;
      bridge.onGuildBuffLevelsUpdated = hydrateBridgeData;
      bridge.onGuildPointSummaryUpdated = hydrateBridgeData;
      setItemDetails(bridge.itemDetails);
      setGuildBuffDetails(bridge.guildBuffDetails);
      setGuildBuffLevelsFrom(bridge);
      setGuildShrineLevelsFrom(bridge);
      setGuildShrineDetailsFrom(bridge);
      setGuildBuildingLevelsFrom(bridge);
      setGuildBuildingDetailsFrom(bridge);
      setGuildPointSummaryFrom(bridge.guildPointSummary);
      setGuildWeekStartAtFrom({
        currentWeekStartAt: bridge.guildWeekStartAt,
        currentWeekGuildPoints: bridge.guildCurrentWeekPoints
      });
      const characterItemsRevision = Number(bridge.characterItemsRevision);
      if (Number.isSafeInteger(characterItemsRevision)) {
        if (characterItemsRevision > state.characterItemsBridgeRevision) {
          if (setCharacterItems(bridge.characterItems)) scheduleInventoryDataRefresh();
          state.characterItemsBridgeRevision = characterItemsRevision;
        } else if (!state.characterItems) {
          setCharacterItems(bridge.characterItems);
        }
      } else {
        setCharacterItems(bridge.characterItems);
      }
      const guildBuffLevelsRevision = Number(bridge.guildBuffLevelsRevision);
      if (
        Number.isSafeInteger(guildBuffLevelsRevision) &&
        guildBuffLevelsRevision > state.guildBuffLevelsBridgeRevision
      ) {
        state.guildBuffLevelsBridgeRevision = guildBuffLevelsRevision;
        scheduleGuildDataRefresh();
      }
      const guildPointSummaryRevision = Number(bridge.guildPointSummaryRevision);
      if (
        Number.isSafeInteger(guildPointSummaryRevision) &&
        guildPointSummaryRevision > state.guildPointSummaryBridgeRevision
      ) {
        state.guildPointSummaryBridgeRevision = guildPointSummaryRevision;
        scheduleGuildDataRefresh();
      }
      const bridgeRevision = Number(bridge.marketOrderBookRevision);
      if (Number.isSafeInteger(bridgeRevision) && bridgeRevision > state.marketBridgeRevision) {
        const records = Object.values(bridge.marketOrderBooks || {})
          .filter((record) => record && Number(record.revision) > state.marketBridgeRevision)
          .sort((left, right) => Number(left.revision) - Number(right.revision));
        for (const record of records) {
          marketChanged = rememberLiveMarketUpdate(record.update, record.receivedAt) || marketChanged;
        }
        state.marketBridgeRevision = bridgeRevision;
      }
      if (Array.isArray(bridge.messages) && bridge.marketObserverActive !== true) {
        const latestMarketUpdates = new Map();
        for (const rawMessage of bridge.messages) {
          try {
            const message = JSON.parse(rawMessage);
            if (String((message && message.type) || "") !== "market_item_order_books_updated") continue;
            const update = marketDataApi.normalizeMarketOrderBooksUpdate(message);
            if (update) latestMarketUpdates.set(update.itemHrid, update);
          } catch (_) {
            // Ignore non-JSON protocol frames.
          }
        }
        for (const update of latestMarketUpdates.values()) {
          marketChanged = rememberLiveMarketUpdate(update) || marketChanged;
        }
      }
      // Current bridges already reconcile characterItems snapshots with
      // endCharacterItems deltas. Only replay raw messages for an older bridge;
      // otherwise an old initialization frame could overwrite the live array.
      if (Array.isArray(bridge.messages) && !Number.isSafeInteger(characterItemsRevision)) {
        for (let index = bridge.messages.length - 1; index >= 0; index -= 1) {
          const rawMessage = bridge.messages[index];
          try {
            const message = JSON.parse(rawMessage);
            scanMessage(message, 0);
          } catch (_) {
            // Ignore non-JSON protocol frames.
          }
        }
      }
      return marketChanged;
    }

    function clearMarketSnapshotCandidate() {
      state.marketSnapshotCandidateSignature = "";
      state.marketSnapshotCandidateTimestamp = 0;
      state.marketSnapshotCandidateConfirmations = 0;
    }

    function confirmMissingMarketSnapshot(marketData, marketTimestamp) {
      const signature = JSON.stringify(marketDataApi.createMarketStructure(marketData));
      const normalizedTimestamp = marketDataApi.normalizeMarketTimestamp(marketTimestamp);
      const matchesCandidate =
        state.marketSnapshotCandidateSignature === signature &&
        normalizedTimestamp >= state.marketSnapshotCandidateTimestamp;
      state.marketSnapshotCandidateSignature = signature;
      state.marketSnapshotCandidateTimestamp = normalizedTimestamp;
      state.marketSnapshotCandidateConfirmations = matchesCandidate
        ? Math.min(2, state.marketSnapshotCandidateConfirmations + 1)
        : 1;
      return state.marketSnapshotCandidateConfirmations >= 2;
    }

    function currentTime() {
      const value = Number(typeof now === "function" ? now() : Date.now());
      return Number.isSafeInteger(value) && value > 0 ? value : Date.now();
    }

    function snapshotCacheCanSatisfy(force, requestedAt) {
      if (!state.snapshot) return false;
      const fetchedAt = Number(state.snapshotFetchedAt);
      if (!Number.isSafeInteger(fetchedAt) || fetchedAt <= 0 || requestedAt < fetchedAt) return false;
      const maxAge = Number(force ? MARKETPLACE_SNAPSHOT_REFRESH_COOLDOWN_MS : MARKETPLACE_SNAPSHOT_MAX_AGE_MS);
      return Number.isFinite(maxAge) && maxAge >= 0 && requestedAt - fetchedAt < maxAge;
    }

    function snapshotOrigin(url) {
      try {
        return new URL(url, pageWindow && pageWindow.location && pageWindow.location.href).origin;
      } catch (_) {
        return "";
      }
    }

    function snapshotSourceLabel(url) {
      try {
        return new URL(url, pageWindow && pageWindow.location && pageWindow.location.href).host || url;
      } catch (_) {
        return url;
      }
    }

    function persistRequestBackoff() {
      if (typeof persistMarketplaceRequestState !== "function") return;
      persistMarketplaceRequestState({
        forbiddenUntilByOrigin: state.marketSnapshotForbiddenUntilByOrigin || Object.create(null)
      });
    }

    function setForbiddenBackoff(origin, requestedAt) {
      if (!origin) return;
      const duration = Number(MARKETPLACE_SNAPSHOT_FORBIDDEN_BACKOFF_MS);
      if (!Number.isFinite(duration) || duration <= 0) return;
      if (!state.marketSnapshotForbiddenUntilByOrigin) {
        state.marketSnapshotForbiddenUntilByOrigin = Object.create(null);
      }
      state.marketSnapshotForbiddenUntilByOrigin[origin] = requestedAt + duration;
      persistRequestBackoff();
    }

    function clearForbiddenBackoff(origin) {
      if (!origin || !state.marketSnapshotForbiddenUntilByOrigin) return;
      if (!Object.prototype.hasOwnProperty.call(state.marketSnapshotForbiddenUntilByOrigin, origin)) return;
      delete state.marketSnapshotForbiddenUntilByOrigin[origin];
      persistRequestBackoff();
    }

    function hasActiveForbiddenBackoff(requestedAt) {
      return Object.values(state.marketSnapshotForbiddenUntilByOrigin || {}).some(
        (forbiddenUntil) => Number.isSafeInteger(Number(forbiddenUntil)) && Number(forbiddenUntil) > requestedAt
      );
    }

    async function requestSnapshot(force, requestedAt) {
      const liveRevisionAtRequestStart = state.marketLiveRevision;
      const request =
        typeof fetchImpl === "function"
          ? fetchImpl
          : pageWindow && typeof pageWindow.fetch === "function"
            ? pageWindow.fetch.bind(pageWindow)
            : typeof fetch === "function"
              ? fetch
              : null;
      if (!request) throw new Error("Fetch API is unavailable.");
      const urls = marketplaceSnapshotUrls(
        pageWindow && pageWindow.location,
        MARKETPLACE_SNAPSHOT_ORIGINS,
        MARKETPLACE_SNAPSHOT_PATH
      );
      const failures = [];
      let rawSnapshot;
      let marketData;
      let nextTimestamp;
      for (const url of urls) {
        const origin = snapshotOrigin(url);
        const forbiddenUntil = Number(
          state.marketSnapshotForbiddenUntilByOrigin && state.marketSnapshotForbiddenUntilByOrigin[origin]
        );
        if (Number.isSafeInteger(forbiddenUntil) && forbiddenUntil > requestedAt) {
          failures.push(`${snapshotSourceLabel(url)}: HTTP 403 backoff`);
          continue;
        }
        if (Number.isSafeInteger(forbiddenUntil) && forbiddenUntil > 0) clearForbiddenBackoff(origin);
        try {
          const response = await request(url, { cache: force ? "reload" : "default" });
          if (!response || !response.ok) {
            if (response && response.status === 403) setForbiddenBackoff(origin, requestedAt);
            throw new Error(`HTTP ${response ? response.status : "unknown"}`);
          }
          clearForbiddenBackoff(origin);
          rawSnapshot = await response.json();
          marketData = marketDataApi.sanitizeMarketData(rawSnapshot && rawSnapshot.marketData);
          if (!Object.keys(marketData).length) throw new Error("Marketplace payload is empty.");
          nextTimestamp = marketDataApi.normalizeMarketTimestamp(rawSnapshot && rawSnapshot.timestamp);
          if (nextTimestamp <= 0) throw new Error("Marketplace payload has no valid timestamp.");
          state.marketSnapshotFallbackActive = false;
          state.marketSnapshotFallbackError = "";
          break;
        } catch (error) {
          failures.push(`${snapshotSourceLabel(url)}: ${error && error.message ? error.message : String(error)}`);
          rawSnapshot = null;
          marketData = null;
          nextTimestamp = 0;
        }
      }
      if (!rawSnapshot || !marketData || nextTimestamp <= 0) {
        if (state.snapshot) {
          state.marketSnapshotFallbackActive = true;
          state.marketSnapshotFallbackError = failures.join("; ");
          return state.snapshot;
        }
        throw new Error(failures.join("; "));
      }
      const snapshot = { ...rawSnapshot, marketData };
      if (state.snapshotTimestamp > 0 && nextTimestamp > 0 && nextTimestamp < state.snapshotTimestamp) {
        return state.snapshot;
      }
      const confirmedMarketData = state.snapshot && state.snapshot.marketData;
      const missingCount = marketDataApi.countMissingMarketEntries(confirmedMarketData, marketData);
      if (missingCount > 0 && nextTimestamp === state.snapshotTimestamp) {
        clearMarketSnapshotCandidate();
        return state.snapshot;
      }
      if (missingCount > 0 && !confirmMissingMarketSnapshot(marketData, nextTimestamp)) {
        return state.snapshot;
      }
      const reconciliation = marketDataApi.reconcileLiveMarketData(state.marketLiveData, {
        previousSnapshotTimestamp: state.snapshotTimestamp,
        nextSnapshotTimestamp: nextTimestamp,
        coveredRevision: liveRevisionAtRequestStart,
        snapshotData: marketData
      });
      if (reconciliation.changed) {
        state.marketUpdateSignatures = Object.create(null);
        persistLiveMarketData();
      }
      state.snapshot = snapshot;
      state.snapshotTimestamp = nextTimestamp || state.snapshotTimestamp;
      state.snapshotFetchedAt = requestedAt;
      if (typeof persistMarketSnapshot === "function") persistMarketSnapshot(snapshot, requestedAt);
      clearMarketSnapshotCandidate();
      return state.snapshot;
    }

    async function loadSnapshot(force) {
      const requestedAt = currentTime();
      if (snapshotCacheCanSatisfy(Boolean(force), requestedAt)) {
        if (hasActiveForbiddenBackoff(requestedAt)) {
          state.marketSnapshotFallbackActive = true;
          state.marketSnapshotFallbackError = "HTTP 403 backoff";
        }
        return state.snapshot;
      }
      if (snapshotLoadPromise) return snapshotLoadPromise;
      snapshotLoadPromise = requestSnapshot(Boolean(force), requestedAt);
      try {
        return await snapshotLoadPromise;
      } finally {
        snapshotLoadPromise = null;
      }
    }

    function snapshotOrderBook(itemHrid, reference = state.priceReference) {
      const price = snapshotPrice(itemHrid, reference);
      return price === null ? null : { asks: [{ price, quantity: Number.MAX_SAFE_INTEGER }] };
    }

    function snapshotPrice(itemHrid, field, enhancementLevel = 0) {
      return marketDataApi.resolveMarketPrice(state.snapshot, state.marketLiveData, itemHrid, enhancementLevel, field);
    }

    function snapshotImmediateSellPrice(itemHrid, enhancementLevel = 0) {
      return snapshotPrice(itemHrid, "b", enhancementLevel);
    }

    function allConversions(creditItemHrid, options = {}) {
      // Prefer data captured from this game session. The persisted init payload is
      // only a fallback, so a previous game version cannot misclassify conversions.
      hydrateBridgeData();
      extractItemDetailsFromReact();
      if (!state.itemDetails) hydrateLocalInitData();
      let conversions = state.conversionCache.get(creditItemHrid);
      if (!conversions) {
        conversions = core.conversionsFromItemDetails(state.itemDetails, creditItemHrid);
        state.conversionCache.set(creditItemHrid, conversions);
      }
      return conversions.flatMap((conversion) => {
        const itemName = resolveItemName(conversion.itemHrid, conversion.itemName);
        if (
          options.applyPriceLimit !== false &&
          Number.isSafeInteger(state.maxConversionItemUnitPrice) &&
          state.maxConversionItemUnitPrice > 0 &&
          !core.isUnitPriceWithinLimit(
            snapshotPrice(conversion.itemHrid, state.priceReference),
            state.maxConversionItemUnitPrice
          )
        )
          return [];
        return [{ ...conversion, itemName }];
      });
    }

    function creditConversionGroups(options) {
      return CREDIT_TYPES.map(([creditItemHrid, color]) => ({
        creditItemHrid,
        color,
        conversions: allConversions(creditItemHrid, options)
      }));
    }

    return {
      hydrateLocalInitData,
      extractItemDetailsFromReact,
      hydrateBridgeData,
      loadSnapshot,
      snapshotOrderBook,
      snapshotPrice,
      snapshotImmediateSellPrice,
      allConversions,
      creditConversionGroups
    };
  }

  return { marketplaceSnapshotUrls, createGameData };
});


// SOURCE: src/ui/dom.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildCreditDom = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function updateRenderedMarkup(element, markup, propertyName) {
    if (!element || element[propertyName] === markup) return false;
    element.innerHTML = markup;
    element[propertyName] = markup;
    return true;
  }

  function escapeHtml(value) {
    return String(value).replace(
      /[&<>'"]/g,
      (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]
    );
  }

  function renderHelpSummary(title, preview) {
    return `<summary class="mwi-help-toggle"><span class="mwi-help-heading">${escapeHtml(title)}</span></summary>${preview ? `<p class="mwi-help-intro">${escapeHtml(preview)}</p>` : ""}`;
  }

  function renderHelpSections(sections) {
    return `<dl class="mwi-help-sections">${sections
      .map(
        ([heading, text]) =>
          `<div><dt>${escapeHtml(heading)}</dt><dd>${String(text)
            .split("\n")
            .filter(Boolean)
            .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
            .join("")}</dd></div>`
      )
      .join("")}</dl>`;
  }

  function itemHridFromIcon(icon) {
    const use = icon && icon.querySelector("use");
    const href = use && (use.getAttribute("href") || use.getAttribute("xlink:href"));
    if (!href || !href.includes("#")) return null;
    return `/items/${href.slice(href.lastIndexOf("#") + 1)}`;
  }

  function enhancementLevelFromIcon(icon) {
    const item = icon && icon.closest('[class*="Item_item"]');
    const label = item && item.querySelector('[class*="Item_enhancementLevel"]');
    const match = String((label && label.textContent) || "")
      .trim()
      .match(/^\+(\d+)$/);
    const level = Number(match && match[1]);
    return Number.isSafeInteger(level) && level >= 0 ? level : 0;
  }

  function spriteBaseFromReference(reference, marker) {
    const value = String(reference || "").trim();
    const normalizedMarker = String(marker || "")
      .trim()
      .toLowerCase();
    if (!value || !normalizedMarker) return "";
    const hashIndex = value.lastIndexOf("#");
    const base = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
    return base.toLowerCase().includes(normalizedMarker) ? base : "";
  }

  function findSpriteBaseHref(root, marker) {
    if (!root || typeof root.querySelectorAll !== "function") return "";
    for (const useElement of root.querySelectorAll("use")) {
      const reference = useElement.getAttribute("href") || useElement.getAttribute("xlink:href");
      const base = spriteBaseFromReference(reference, marker);
      if (base) return base;
    }
    return "";
  }

  function spriteBaseFromAssetManifest(manifest, marker) {
    if (!manifest || typeof manifest !== "object" || !manifest.files || typeof manifest.files !== "object") return "";
    for (const [name, reference] of Object.entries(manifest.files)) {
      const base = spriteBaseFromReference(reference, marker);
      if (
        base ||
        String(name)
          .toLowerCase()
          .includes(String(marker || "").toLowerCase())
      )
        return base || String(reference);
    }
    return "";
  }

  return {
    updateRenderedMarkup,
    escapeHtml,
    renderHelpSummary,
    renderHelpSections,
    itemHridFromIcon,
    enhancementLevelFromIcon,
    spriteBaseFromReference,
    findSpriteBaseHref,
    spriteBaseFromAssetManifest
  };
});


// SOURCE: src/ui/sidebar-dom.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildCreditSidebarDom = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SIDEBAR_LABELS = {
    "zh-CN": ["庫存", "裝備", "技能", "房屋", "配裝", "收穫"],
    en: ["Inventory", "Equipment", "Skills", "House", "Loadout", "Loadouts", "Harvest", "Gathering"]
  };
  const EXPECTED_LABELS = new Set(Object.values(SIDEBAR_LABELS).flat());
  const TAB_BAR_SELECTOR =
    '[role="tablist"],.MuiTabs-flexContainer,[class*="TabsComponent_tabsContainer"],[class*="TabsComponent_tabList"]';
  const MAX_SIDEBAR_ANCESTORS = 12;

  function labelForTab(tab) {
    return String(tab.innerText || tab.textContent || "")
      .replaceAll("\n", "")
      .trim();
  }

  function isPanelHost(node) {
    return /tabPanelsContainer/.test(String(node?.className || ""));
  }

  function containsNativeTabBar(node) {
    if (nativeTabs(node).length >= 4) return true;
    return Array.from(node.querySelectorAll?.(`${TAB_BAR_SELECTOR},nav`) || []).some(
      (candidate) => nativeTabs(candidate).length >= 4
    );
  }

  function findPanelHost(tabBar) {
    let branch = tabBar;
    // Resolve the nearest shared container instead of assuming a fixed number
    // of Material UI wrappers. Never escape a panel into an unrelated sidebar.
    for (let depth = 0; depth < MAX_SIDEBAR_ANCESTORS; depth += 1) {
      const parent = branch?.parentElement;
      if (!parent || /^(BODY|HTML|MAIN)$/.test(parent.tagName || "") || isPanelHost(parent)) return null;
      const siblings = Array.from(parent.children || []).filter((node) => node !== branch);
      const panelHosts = siblings.filter(isPanelHost);
      if (siblings.some((node) => !isPanelHost(node) && containsNativeTabBar(node))) return null;
      if (panelHosts.length) return panelHosts.length === 1 ? panelHosts[0] : null;
      branch = parent;
    }
    return null;
  }

  function integrationForCustomTab(tab) {
    const tabBar = tab?.parentElement;
    const panelHost = findPanelHost(tabBar);
    return tabBar && panelHost ? { tabBar, panelHost } : null;
  }

  function sidebarLocale(labels) {
    const counts = { "zh-CN": 0, en: 0 };
    for (const label of Array.isArray(labels) ? labels : []) {
      if (SIDEBAR_LABELS["zh-CN"].includes(label)) counts["zh-CN"] += 1;
      else if (SIDEBAR_LABELS.en.includes(label)) counts.en += 1;
    }
    if (counts["zh-CN"] === counts.en) return null;
    return counts["zh-CN"] > counts.en ? "zh-CN" : "en";
  }

  function nativeTabs(tabBar) {
    return Array.from(tabBar.children || [], (element) => ({ element, label: labelForTab(element) })).filter((tab) =>
      EXPECTED_LABELS.has(tab.label)
    );
  }

  function visibleTabBar(tabBar) {
    const rect = tabBar?.getBoundingClientRect?.();
    return Boolean(tabBar?.isConnected && rect?.width > 0 && rect?.height > 0);
  }

  function findSidebarIntegration(documentRef, preferredLocale) {
    if (!documentRef) return null;
    let bestIntegration = null;
    const visited = new Set();
    function inspect(candidate) {
      if (visited.has(candidate)) return;
      visited.add(candidate);
      const recognized = nativeTabs(candidate);
      if (recognized.length < 4) return;
      const panelHost = findPanelHost(candidate);
      if (!panelHost) return;
      const detectedLocale = sidebarLocale(recognized.map((tab) => tab.label));
      const prototypeLabels =
        (detectedLocale || preferredLocale) === "zh-CN" ? ["庫存", "Inventory"] : ["Inventory", "庫存"];
      const prototype = recognized.find((tab) => prototypeLabels.includes(tab.label)) || recognized[0];
      const integration = {
        tabBar: candidate,
        tabPrototype: prototype.element,
        panelHost,
        detectedLocale,
        score: (visibleTabBar(candidate) ? 1000 : 0) + recognized.length
      };
      if (!bestIntegration || integration.score > bestIntegration.score) bestIntegration = integration;
    }
    for (const candidate of documentRef.querySelectorAll?.(TAB_BAR_SELECTOR) || []) inspect(candidate);
    if (bestIntegration?.score >= 1000) return bestIntegration;
    // Older layouts and startup fixtures may not expose tab roles or MUI
    // classes. Keep a recovery scan, including when targeted layouts are hidden.
    for (const candidate of documentRef.getElementsByTagName?.("*") || []) inspect(candidate);
    return bestIntegration;
  }

  function createIntegrationLocator(documentRef, now = Date.now, find = findSidebarIntegration) {
    let cached = null;
    let scannedAt = -Infinity;
    return function locate(locale) {
      const tabBar = cached?.tabBar;
      const current = tabBar && integrationForCustomTab(cached.tabPrototype);
      const valid =
        visibleTabBar(tabBar) &&
        cached.panelHost.isConnected &&
        cached.tabPrototype.parentElement === tabBar &&
        current?.panelHost === cached.panelHost;
      const timestamp = now();
      if (!valid || timestamp - scannedAt >= 30000) {
        cached = find(documentRef, locale);
        scannedAt = timestamp;
      } else {
        cached.detectedLocale = sidebarLocale(Array.from(tabBar.children, labelForTab));
      }
      return cached;
    };
  }

  function hasForeignIdentity(node) {
    return (
      node?.dataset?.mwitoolsCharacterTab === "true" ||
      node?.dataset?.mwiGitTab === "true" ||
      node?.hasAttribute?.("data-mooncake-enhancement-tab-button")
    );
  }

  function isOwnedSidebarTab(node) {
    if (node?.dataset?.mwiCreditTab !== "true" || hasForeignIdentity(node)) return false;
    // External plugins can clone all data attributes. Their own ID or marker
    // takes precedence over inherited ownership and stale-node markers.
    return node.id === "mwi-credit-sidebar-tab" || (!node.id && node.dataset.mwiCreditSuperseded === "true");
  }

  function suppressStaleMounts(integration, tab, panel) {
    let selected = false;
    const documentRef = integration.tabBar.ownerDocument;
    const stale = [
      ...Array.from(documentRef.querySelectorAll('[data-mwi-credit-tab="true"]')).filter(
        (node) => node !== tab && isOwnedSidebarTab(node)
      ),
      ...Array.from(documentRef.querySelectorAll("#mwi-credit-optimizer,[data-mwi-credit-stale-panel]")).filter(
        (node) =>
          node !== panel &&
          !hasForeignIdentity(node) &&
          (node.id === "mwi-credit-optimizer" || (!node.id && node.hasAttribute("data-mwi-credit-stale-panel")))
      )
    ];
    for (const node of stale) {
      selected ||= node.getAttribute("aria-selected") === "true" && !node.hidden;
      if (node.dataset.mwiCreditSuperseded === "true" && node.hidden) continue;
      node.dataset.mwiCreditSuperseded = "true";
      if (node.id === "mwi-credit-optimizer") node.dataset.mwiCreditStalePanel = "true";
      node.hidden = true;
      node.inert = true;
      node.classList.remove("Mui-selected");
      node.setAttribute("aria-hidden", "true");
      node.setAttribute("aria-selected", "false");
      node.setAttribute("tabindex", "-1");
      // Old panel descendants have fixed IDs too; never let them shadow the live panel.
      for (const identified of [node, ...node.querySelectorAll("[id]")]) identified.removeAttribute("id");
    }
    return selected;
  }

  function prepareTab(tab, panel) {
    tab.id = "mwi-credit-sidebar-tab";
    tab.hidden = false;
    tab.inert = false;
    for (const name of ["disabled", "aria-disabled", "aria-hidden", "data-mwi-credit-superseded"])
      tab.removeAttribute(name);
    tab.classList.remove("Mui-selected");
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", "false");
    tab.setAttribute("aria-controls", panel.id);
    tab.tabIndex = -1;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    panel.tabIndex = 0;
  }

  function createTab(tabPrototype, panel, label) {
    const tab = tabPrototype.ownerDocument.createElement("button");
    tab.type = "button";
    tab.className = String(tabPrototype.className || "")
      .split(/\s+/)
      .filter((className) => className && className !== "Mui-selected")
      .join(" ");
    tab.dataset.mwiCreditTab = "true";
    tab.textContent = String(label ?? "");
    prepareTab(tab, panel);
    return tab;
  }

  return Object.freeze({
    SIDEBAR_LABELS,
    sidebarLocale,
    findSidebarIntegration,
    integrationForCustomTab,
    createIntegrationLocator,
    suppressStaleMounts,
    isOwnedSidebarTab,
    prepareTab,
    createTab
  });
});


// SOURCE: src/ui/sidebar-interaction.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildCreditSidebarInteraction = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SIDEBAR_ACTIVATION_EVENT = "mwi:sidebar-plugin-activated";
  const WHEEL_ATTRIBUTE = "data-mwi-sidebar-wheel-scroll";
  // DOM attributes survive cloneNode(); event listeners do not.
  const wheelBindings = new WeakMap();
  const WHEEL_STYLES = {
    "max-width": "100%",
    "min-width": "0",
    "overflow-x": "auto",
    "overflow-y": "hidden",
    "overscroll-behavior-inline": "contain",
    "scrollbar-width": "none"
  };

  function styleProperty(name) {
    return name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  function readStyle(style, name) {
    return {
      value: style.getPropertyValue?.(name) ?? style[styleProperty(name)] ?? "",
      priority: style.getPropertyPriority?.(name) || ""
    };
  }

  function writeStyle(style, name, value, priority = "") {
    if (typeof style.setProperty === "function") {
      if (value === "") style.removeProperty(name);
      else style.setProperty(name, value, priority);
    } else style[styleProperty(name)] = value;
  }

  function claimStyle(node, name, value, priority = "") {
    const previous = readStyle(node.style, name);
    writeStyle(node.style, name, value, priority);
    return { previous, written: readStyle(node.style, name) };
  }

  function restoreStyle(node, name, record) {
    const current = readStyle(node.style, name);
    if (current.value === record.written.value && current.priority === record.written.priority)
      writeStyle(node.style, name, record.previous.value, record.previous.priority);
  }

  function enableSidebarTabWheelScrolling(tabBar) {
    if (!tabBar || typeof tabBar.addEventListener !== "function") return false;
    if (wheelBindings.has(tabBar)) return true;
    const styles = new Map();
    if (tabBar.style) {
      for (const [name, value] of Object.entries(WHEEL_STYLES)) styles.set(name, claimStyle(tabBar, name, value));
    }
    const listener = (event) => {
      if (event.ctrlKey || event.defaultPrevented || event.cancelable === false) return;
      const width = Number(tabBar.clientWidth);
      const max = Number(tabBar.scrollWidth) - width;
      if (!Number.isFinite(max) || max <= 0) return;
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      let delta = horizontal ? event.deltaX : event.deltaY;
      if (!Number.isFinite(delta) || delta === 0) return;
      if (event.deltaMode === 1) delta *= 16;
      else if (event.deltaMode === 2) delta *= Math.max(1, width);
      const raw = Number(tabBar.scrollLeft) || 0;
      const view = tabBar.ownerDocument?.defaultView;
      const direction = view?.getComputedStyle?.(tabBar)?.direction || tabBar.style?.direction;
      const rtl = direction === "rtl" || (direction !== "ltr" && raw < 0);
      // Horizontal gestures retain physical direction; vertical gestures advance
      // toward inline-end, including negative scrollLeft in modern RTL layouts.
      if (rtl && !horizontal) delta = -delta;
      const min = rtl ? -max : 0;
      const limit = rtl ? 0 : max;
      const current = Math.min(limit, Math.max(min, raw));
      const next = Math.min(limit, Math.max(min, current + delta));
      if (next === current) return;
      tabBar.scrollLeft = next;
      if (Number(tabBar.scrollLeft) !== raw) event.preventDefault();
    };
    tabBar.addEventListener("wheel", listener, { passive: false });
    tabBar.setAttribute?.(WHEEL_ATTRIBUTE, "true");
    wheelBindings.set(tabBar, { listener, styles });
    return true;
  }

  function disableSidebarTabWheelScrolling(tabBar) {
    const binding = tabBar && wheelBindings.get(tabBar);
    if (!binding) return false;
    tabBar.removeEventListener?.("wheel", binding.listener);
    for (const [name, record] of binding.styles) restoreStyle(tabBar, name, record);
    if (tabBar.getAttribute?.(WHEEL_ATTRIBUTE) === "true") tabBar.removeAttribute?.(WHEEL_ATTRIBUTE);
    wheelBindings.delete(tabBar);
    return true;
  }

  function createActivationCoordinator(options = {}) {
    const eventTarget = options.eventTarget;
    const CustomEventConstructor = options.CustomEvent;
    const owner = String(options.owner || "").trim();
    const onDeactivate = typeof options.onDeactivate === "function" ? options.onDeactivate : () => {};
    let started = false;
    function handleActivation(event) {
      const activeOwner = typeof event?.detail === "string" ? event.detail : "";
      if (activeOwner && activeOwner !== owner) onDeactivate(activeOwner);
    }
    function start() {
      if (started) return true;
      if (!owner || typeof eventTarget?.addEventListener !== "function") return false;
      eventTarget.addEventListener(SIDEBAR_ACTIVATION_EVENT, handleActivation);
      started = true;
      return true;
    }
    function announce() {
      if (!started) start();
      if (!started || typeof eventTarget?.dispatchEvent !== "function" || typeof CustomEventConstructor !== "function")
        return false;
      eventTarget.dispatchEvent(new CustomEventConstructor(SIDEBAR_ACTIVATION_EVENT, { detail: owner }));
      return true;
    }
    function destroy() {
      if (!started) return;
      eventTarget.removeEventListener(SIDEBAR_ACTIVATION_EVENT, handleActivation);
      started = false;
    }
    return Object.freeze({ start, announce, destroy });
  }

  function createDocumentActivationCoordinator(windowRef, owner, onDeactivate) {
    const coordinator = createActivationCoordinator({
      eventTarget: windowRef?.document,
      CustomEvent: windowRef?.CustomEvent,
      owner,
      onDeactivate
    });
    coordinator.start();
    return coordinator;
  }

  function selected(tab) {
    return tab.getAttribute("aria-selected") === "true" || tab.classList.contains("Mui-selected");
  }

  function restoreAttribute(node, name, previous, written) {
    if (node.getAttribute(name) !== written) return;
    if (previous === null) node.removeAttribute(name);
    else node.setAttribute(name, previous);
  }

  function createSelectionController(state) {
    const hiddenNodes = new Map();
    const tabStates = new Map();
    let active = null;

    function otherSelected(tabBar = active?.tabBar) {
      return Array.from(tabBar?.children || []).some((tab) => tab !== active?.tab && !tab.hidden && selected(tab));
    }

    function captureSiblings(panelHost, tabBar) {
      for (const node of panelHost.children) {
        if (node === active.panel || hiddenNodes.has(node) || !node.style) continue;
        hiddenNodes.set(node, claimStyle(node, "display", "none", "important"));
      }
      for (const tab of tabBar.children) {
        if (tab === active.tab || tab.hidden || tabStates.has(tab)) continue;
        tabStates.set(tab, {
          tabindex: tab.getAttribute("tabindex"),
          aria: tab.getAttribute("aria-selected"),
          selected: tab.classList.contains("Mui-selected")
        });
        tab.classList.remove("Mui-selected");
        tab.setAttribute("aria-selected", "false");
        tab.tabIndex = -1;
      }
    }

    function sync(panelHost, tabBar) {
      if (
        !active ||
        !panelHost ||
        !tabBar ||
        active.panel.hidden ||
        active.tab.getAttribute("aria-selected") !== "true" ||
        !active.tab.classList.contains("Mui-selected") ||
        otherSelected(tabBar)
      )
        return false;
      active.panelHost = panelHost;
      active.tabBar = tabBar;
      captureSiblings(panelHost, tabBar);
      return true;
    }

    function show(panelHost, tabBar) {
      if (!state.panel || !state.creditTab || !panelHost || !tabBar) return false;
      if (active) {
        if (active.panel === state.panel && active.tab === state.creditTab && sync(panelHost, tabBar)) return true;
        // Explicit activation may reclaim a sidebar after an external change;
        // passive sync never does. Release the previous ownership first.
        hide();
      }
      active = { panel: state.panel, tab: state.creditTab, panelHost, tabBar };
      captureSiblings(panelHost, tabBar);
      active.panel.hidden = false;
      active.tab.classList.add("Mui-selected");
      active.tab.setAttribute("aria-selected", "true");
      active.tab.tabIndex = 0;
      return true;
    }

    function hide() {
      if (!active) return;
      const { panel, tab: creditTab } = active;
      panel.hidden = true;
      creditTab.classList.remove("Mui-selected");
      restoreAttribute(creditTab, "aria-selected", "false", "true");
      restoreAttribute(creditTab, "tabindex", "-1", "0");
      for (const [node, record] of hiddenNodes) restoreStyle(node, "display", record);
      hiddenNodes.clear();
      const anotherSelected = otherSelected();
      for (const [tab, previous] of tabStates) {
        // Selection may have moved without a click. Do not restore a previously
        // selected native tab on top of another plugin's current selection.
        if (selected(tab)) continue;
        if (!anotherSelected || previous.tabindex !== "0") restoreAttribute(tab, "tabindex", previous.tabindex, "-1");
        if (!anotherSelected) {
          if (tab.getAttribute("aria-selected") === "false") {
            if (previous.selected) tab.classList.add("Mui-selected");
            restoreAttribute(tab, "aria-selected", previous.aria, "false");
          }
        }
      }
      tabStates.clear();
      active = null;
    }

    return { show, hide, sync, isActive: () => active !== null };
  }

  return {
    SIDEBAR_ACTIVATION_EVENT,
    enableSidebarTabWheelScrolling,
    disableSidebarTabWheelScrolling,
    createActivationCoordinator,
    createDocumentActivationCoordinator,
    createSelectionController
  };
});


// SOURCE: src/ui/sidebar-integration.js
(function (root, factory) {
  const commonjs = typeof module !== "undefined" && module.exports;
  const dom = commonjs ? require("./sidebar-dom.js") : root.MwiGuildCreditSidebarDom;
  const interaction = commonjs ? require("./sidebar-interaction.js") : root.MwiGuildCreditSidebarInteraction;
  const api = factory(dom, interaction);
  if (commonjs) module.exports = api;
  root.MwiGuildCreditSidebarIntegration = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (dom, interaction) {
  "use strict";

  const SIDEBAR_REPLACEMENT_EVENT = "mwi:guild-sidebar-replacing";
  const OWNER = "mwi-guild-credit-optimizer";
  const isSelected = (tab) => tab.getAttribute("aria-selected") === "true" || tab.classList.contains("Mui-selected");
  const ownsSelection = (tab) => tab.getAttribute("aria-selected") === "true" && tab.classList.contains("Mui-selected");
  const isAvailable = (tab) =>
    tab.matches('button,[role="tab"]') &&
    !tab.closest('[hidden],[inert],[aria-hidden="true"]') &&
    !tab.disabled &&
    tab.getAttribute("aria-disabled") !== "true" &&
    tab.getClientRects().length > 0;
  const isPrimaryAction = (event) =>
    !(event.button > 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey);

  // Own only the listeners for the current mount. Never reorder native or foreign tabs.
  function createLifecycle(options) {
    const { window: windowRef, state, onActivate, onDeactivate, onChange } = options;
    const documentRef = windowRef.document;
    const locate = dom.createIntegrationLocator(documentRef);
    const focusWrites = new Map();
    let integration = null;
    let observer = null;
    let observedRoot = null;
    let destroyed = false;

    function clickedTab(event) {
      const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
      return Array.from(integration?.tabBar.children || []).find((tab) => tab.contains(target));
    }

    function restoreFocusWrites() {
      for (const [tab, { previous, written }] of focusWrites) {
        if (tab.getAttribute("tabindex") !== written) continue;
        if (previous === null) tab.removeAttribute("tabindex");
        else tab.setAttribute("tabindex", previous);
      }
      focusWrites.clear();
    }

    function leave(event) {
      if (!isPrimaryAction(event)) return;
      const tab = clickedTab(event);
      if (tab && tab !== state.creditTab && isAvailable(tab)) {
        restoreFocusWrites();
        onDeactivate();
      }
    }

    function activate(event) {
      const tab = clickedTab(event);
      if (tab !== state.creditTab || !tab || !isAvailable(tab) || !isPrimaryAction(event)) return;
      if (tab.dataset.mwiCreditSuperseded === "true") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      tab.focus({ preventScroll: true });
      tab.scrollIntoView({ block: "nearest", inline: "nearest" });
      if (state.panel.hidden || !ownsSelection(tab)) onActivate(integration.panelHost, integration.tabBar);
    }

    function keydown(event) {
      const tab = clickedTab(event);
      if (!tab || !isPrimaryAction(event)) return;
      const tabs = Array.from(integration.tabBar.children).filter(isAvailable);
      const index = tabs.indexOf(tab);
      if (index < 0) return;
      const rtl = windowRef.getComputedStyle(integration.tabBar).direction === "rtl";
      let next;
      if (event.key === "ArrowRight") next = tabs[(index + (rtl ? tabs.length - 1 : 1)) % tabs.length];
      else if (event.key === "ArrowLeft") next = tabs[(index + (rtl ? 1 : tabs.length - 1)) % tabs.length];
      else if (event.key === "Home") next = tabs[0];
      else if (event.key === "End") next = tabs.at(-1);
      else if (event.key === "Enter" || event.key === " ") next = tab;
      else return;
      event.preventDefault();
      event.stopImmediatePropagation();
      for (const candidate of tabs) {
        const previous = focusWrites.has(candidate)
          ? focusWrites.get(candidate).previous
          : candidate.getAttribute("tabindex");
        const written = candidate === next ? "0" : "-1";
        focusWrites.set(candidate, { previous, written });
        if (candidate.getAttribute("tabindex") !== written) candidate.setAttribute("tabindex", written);
      }
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: "nearest", inline: "nearest" });
      // Focus moves without invoking another plugin's action (APG manual activation).
      if (event.key === "Enter" || event.key === " ") next.click();
    }

    function detachBar() {
      if (!integration) return;
      integration.tabBar.removeEventListener("click", activate, true);
      integration.tabBar.removeEventListener("keydown", keydown, true);
      interaction.disableSidebarTabWheelScrolling(integration.tabBar);
      restoreFocusWrites();
    }

    function mutations(records) {
      if (destroyed) return;
      if (state.creditTab?.dataset.mwiCreditSuperseded === "true") return onChange();
      if (!integration || !state.creditTab?.isConnected || !state.panel?.isConnected) return onChange();
      const relevant = records.some(({ target }) => {
        const element = target.nodeType === 1 ? target : target.parentElement;
        return (
          element === integration.panelHost ||
          element === integration.tabBar ||
          element === state.creditTab ||
          (integration.tabBar.contains(element) && !state.creditTab.contains(element)) ||
          element?.contains(integration.tabBar)
        );
      });
      if (!relevant) return;
      const others = Array.from(integration.tabBar.children).some(
        (tab) => tab !== state.creditTab && !tab.hidden && isSelected(tab)
      );
      if (!state.panel.hidden && (others || !ownsSelection(state.creditTab))) onDeactivate();
      onChange();
    }

    function watch(found) {
      if (destroyed) return;
      if (integration?.tabBar !== found?.tabBar) {
        detachBar();
        found?.tabBar.addEventListener("click", activate, true);
        found?.tabBar.addEventListener("keydown", keydown, true);
        if (found) interaction.enableSidebarTabWheelScrolling(found.tabBar);
      }
      integration = found;
      const root = found?.panelHost.parentElement?.parentElement || documentRef.documentElement;
      if (observedRoot === root) return;
      observer?.disconnect();
      observedRoot = root;
      observer = new windowRef.MutationObserver(mutations);
      observer.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["class", "style", "hidden", "aria-selected"]
      });
    }

    // Leave before document/target capture handlers can stop event propagation.
    windowRef.addEventListener("click", leave, true);
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      observer?.disconnect();
      detachBar();
      windowRef.removeEventListener("click", leave, true);
      onDeactivate();
      integration = null;
      observedRoot = null;
    }
    return { locate, watch, destroy };
  }

  // One owner for mounting, selection, scheduling and teardown. Feature views are callbacks.
  function createController(options) {
    const { window: windowRef, state, getLocale, getLabel, createPanel, recreatePanel } = options;
    const selection = interaction.createSelectionController(state);
    const coordinator = interaction.createDocumentActivationCoordinator(windowRef, OWNER, selection.hide);
    const lifecycle = createLifecycle({
      window: windowRef,
      state,
      onActivate: show,
      onDeactivate: selection.hide,
      onChange: schedule
    });
    let pending = null;
    let interval = null;
    let started = false;
    let destroyed = false;
    let resumeOpen = false;

    function replacementRequested(event) {
      if (event.detail === OWNER) destroy();
    }

    function show(panelHost, tabBar) {
      if (destroyed || !state.panel?.isConnected) return;
      coordinator.announce();
      selection.show(panelHost, tabBar);
      options.onActivate?.(state.panel);
    }

    function refresh() {
      if (destroyed) return false;
      if (state.creditTab?.dataset.mwiCreditSuperseded === "true") {
        destroy();
        return false;
      }
      const contentChanged = options.beforeRefresh?.();
      const found = lifecycle.locate(getLocale());
      lifecycle.watch(found);
      if (!found) return false;
      const { tabBar, tabPrototype, panelHost, detectedLocale } = found;
      if (detectedLocale) options.onLocale?.(detectedLocale);
      const locale = getLocale();
      const staleSelected = dom.suppressStaleMounts(found, state.creditTab, state.panel) || resumeOpen;
      resumeOpen = false;
      const localeChanged = Boolean(state.panel && state.panelLocale && state.panelLocale !== locale);
      const currentIntegrationMatches = Boolean(
        state.panel?.isConnected &&
        state.panel.parentElement === panelHost &&
        state.creditTab?.isConnected &&
        state.creditTab.parentElement === tabBar
      );
      if (currentIntegrationMatches && !localeChanged) {
        const label = getLabel();
        if (state.creditTab.textContent !== label) state.creditTab.textContent = label;
        if (staleSelected) show(panelHost, tabBar);
        else if (selection.isActive() && !selection.sync(panelHost, tabBar)) selection.hide();
        if (contentChanged && !state.panel.hidden) options.onRefresh?.(state.panel);
        return true;
      }

      const keepPanelOpen =
        staleSelected || Boolean(state.panel && !state.panel.hidden && state.creditTab && isSelected(state.creditTab));
      const tabHadFocus = state.creditTab === windowRef.document.activeElement;
      const reuseTab = Boolean(
        state.creditTab?.isConnected &&
        state.creditTab.parentElement === tabBar &&
        dom.isOwnedSidebarTab(state.creditTab)
      );
      // Recreate before hide so the panel shell can snapshot its focus and scroll position.
      const replacement = localeChanged && state.panel ? recreatePanel(state.panel) : null;
      selection.hide();
      if (!reuseTab) state.creditTab?.remove();
      const panel = replacement || state.panel || createPanel();
      panel.hidden = true;
      const label = getLabel();
      const tab = reuseTab ? state.creditTab : dom.createTab(tabPrototype, panel, label);
      if (reuseTab) {
        // Other plugins may anchor their buttons to this node. Updating only our
        // panel/locale must retain its identity and position within the same bar.
        dom.prepareTab(tab, panel);
        if (tab.textContent !== label) tab.textContent = label;
      }
      panelHost.append(panel);
      if (!reuseTab) tabBar.append(tab);
      state.panel = panel;
      state.creditTab = tab;
      state.panelLocale = locale;
      options.onMount?.(panel);
      if (keepPanelOpen) show(panelHost, tabBar);
      if (tabHadFocus) tab.focus({ preventScroll: true });
      return true;
    }

    function schedule() {
      if (destroyed || pending !== null) return;
      pending = windowRef.setTimeout(() => {
        pending = null;
        refresh();
      }, 75);
    }

    function start() {
      if (started || destroyed) return;
      started = true;
      // Release an older controller synchronously, before acquiring any shared
      // styles. Equal inline values cannot prove ownership across instances.
      const documentRef = windowRef.document;
      resumeOpen = Array.from(documentRef.querySelectorAll('[data-mwi-credit-tab="true"]')).some(
        (tab) => dom.isOwnedSidebarTab(tab) && !tab.hidden && isSelected(tab)
      );
      documentRef.dispatchEvent(new windowRef.CustomEvent(SIDEBAR_REPLACEMENT_EVENT, { detail: OWNER }));
      documentRef.addEventListener(SIDEBAR_REPLACEMENT_EVENT, replacementRequested);
      interval = windowRef.setInterval(refresh, 3000);
      windowRef.addEventListener("resize", schedule, { passive: true });
      windowRef.addEventListener("orientationchange", schedule, { passive: true });
      refresh();
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      windowRef.clearTimeout(pending);
      windowRef.clearInterval(interval);
      lifecycle.destroy();
      coordinator.destroy();
      windowRef.document.removeEventListener(SIDEBAR_REPLACEMENT_EVENT, replacementRequested);
      windowRef.removeEventListener("resize", schedule);
      windowRef.removeEventListener("orientationchange", schedule);
      pending = null;
      interval = null;
    }
    return { start, refresh, destroy };
  }

  return { ...dom, ...interaction, SIDEBAR_REPLACEMENT_EVENT, createLifecycle, createController };
});


// SOURCE: src/ui/sortable.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildCreditSortable = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeOrder(order, allowed, fallback = allowed) {
    const allowedSet = new Set(allowed);
    const normalized = [];
    for (const value of Array.isArray(order) ? order : []) {
      if (allowedSet.has(value) && !normalized.includes(value)) normalized.push(value);
    }
    for (const value of fallback) {
      if (allowedSet.has(value) && !normalized.includes(value)) normalized.push(value);
    }
    for (const value of allowed) {
      if (!normalized.includes(value)) normalized.push(value);
    }
    return normalized;
  }

  function reorderByIndex(items, fromIndex, toIndex) {
    const next = Array.from(items || []);
    if (
      !Number.isInteger(fromIndex) ||
      !Number.isInteger(toIndex) ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= next.length ||
      toIndex >= next.length ||
      fromIndex === toIndex
    )
      return next;
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    return next;
  }

  function reorderVisibleByIndex(order, visibleValues, value, toIndex) {
    const fullOrder = Array.from(order || []);
    const visibleSet = new Set(visibleValues || []);
    const visibleOrder = fullOrder.filter((candidate) => visibleSet.has(candidate));
    const fromIndex = visibleOrder.indexOf(value);
    const nextVisibleOrder = reorderByIndex(visibleOrder, fromIndex, toIndex);
    if (nextVisibleOrder.every((candidate, index) => candidate === visibleOrder[index])) return fullOrder;
    let visibleIndex = 0;
    return fullOrder.map((candidate) => (visibleSet.has(candidate) ? nextVisibleOrder[visibleIndex++] : candidate));
  }

  function createPointerSortable(options) {
    const {
      root,
      containerSelector,
      itemSelector,
      handleSelector = itemSelector,
      axis = "y",
      threshold = 6,
      scrollContainerSelector,
      onCommit
    } = options || {};
    if (!root || typeof root.addEventListener !== "function") return { destroy() {} };

    const ownerDocument = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    const ownerWindow = ownerDocument && ownerDocument.defaultView;
    let drag = null;
    let suppressClick = false;
    root.querySelectorAll(containerSelector).forEach((container) => container.classList.add(`mwi-sort-axis-${axis}`));

    function sortableItems(container) {
      return Array.from(container.querySelectorAll(itemSelector)).filter((item) => item.parentElement === container);
    }

    function clearMarkers() {
      if (!drag) return;
      for (const item of sortableItems(drag.container)) {
        item.classList.remove("mwi-sort-drop-before", "mwi-sort-drop-after", "mwi-sort-dragging");
        item.style.removeProperty("transform");
        item.style.removeProperty("z-index");
      }
      drag.container.classList.remove("mwi-sort-active");
    }

    function finish(commit) {
      if (!drag) return;
      const finished = drag;
      clearMarkers();
      drag = null;
      if (commit && finished.dragging) suppressClick = true;
      if (commit && finished.dragging && finished.toIndex !== finished.fromIndex && typeof onCommit === "function") {
        onCommit({
          key: finished.key,
          fromIndex: finished.fromIndex,
          toIndex: finished.toIndex,
          container: finished.container
        });
      }
    }

    function indexAtPointer(items, coordinate) {
      let insertionIndex = items.length;
      for (let index = 0; index < items.length; index += 1) {
        const rect = items[index].getBoundingClientRect();
        const midpoint = axis === "x" ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
        if (coordinate < midpoint) {
          insertionIndex = index;
          break;
        }
      }
      return insertionIndex;
    }

    function updateDropTarget(event) {
      const items = sortableItems(drag.container);
      const candidates = items.filter((item) => item !== drag.item);
      const coordinate = axis === "x" ? event.clientX : event.clientY;
      const insertionIndex = indexAtPointer(candidates, coordinate);
      const toIndex = Math.max(0, Math.min(items.length - 1, insertionIndex));
      drag.toIndex = toIndex;
      for (const item of items) item.classList.remove("mwi-sort-drop-before", "mwi-sort-drop-after");
      const markerIndex = Math.min(insertionIndex, candidates.length - 1);
      const marker = candidates[markerIndex];
      if (marker) {
        marker.classList.add(insertionIndex >= candidates.length ? "mwi-sort-drop-after" : "mwi-sort-drop-before");
      }

      const delta = coordinate - (axis === "x" ? drag.startX : drag.startY);
      drag.item.style.transform = axis === "x" ? `translateX(${delta}px)` : `translateY(${delta}px)`;
      drag.item.style.zIndex = "8";

      const scrollContainer =
        (scrollContainerSelector && drag.container.closest(scrollContainerSelector)) ||
        (axis === "y" ? root : drag.container);
      const rect = scrollContainer.getBoundingClientRect();
      const edge = 36;
      const scrollDelta =
        coordinate < (axis === "x" ? rect.left : rect.top) + edge
          ? -12
          : coordinate > (axis === "x" ? rect.right : rect.bottom) - edge
            ? 12
            : 0;
      if (scrollDelta && typeof scrollContainer.scrollBy === "function") {
        scrollContainer.scrollBy(axis === "x" ? { left: scrollDelta } : { top: scrollDelta });
      }
    }

    function pointerDown(event) {
      if (event.button !== undefined && event.button !== 0) return;
      if (event.isPrimary === false) return;
      const target = event.target && (event.target.nodeType === 1 ? event.target : event.target.parentElement);
      const handle = target && target.closest(handleSelector);
      const item = handle && handle.closest(itemSelector);
      const container = item && item.closest(containerSelector);
      if (!handle || !item || !container || !root.contains(container) || item.parentElement !== container) return;
      container.classList.add(`mwi-sort-axis-${axis}`);
      const items = sortableItems(container);
      const fromIndex = items.indexOf(item);
      if (fromIndex < 0 || items.length < 2) return;
      drag = {
        pointerId: event.pointerId,
        handle,
        item,
        container,
        key: item.dataset.sortKey || "",
        startX: event.clientX,
        startY: event.clientY,
        fromIndex,
        toIndex: fromIndex,
        dragging: false
      };
    }

    function pointerMove(event) {
      if (!drag || (drag.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (!drag.dragging && distance < threshold) return;
      if (!drag.dragging) {
        drag.dragging = true;
        if (typeof drag.handle.setPointerCapture === "function" && event.pointerId !== undefined) {
          try {
            drag.handle.setPointerCapture(event.pointerId);
          } catch (_) {
            // Some synthetic or detached pointer targets cannot capture safely.
          }
        }
        drag.item.classList.add("mwi-sort-dragging");
        drag.container.classList.add("mwi-sort-active");
      }
      event.preventDefault();
      updateDropTarget(event);
    }

    function pointerUp(event) {
      if (!drag || (drag.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
      finish(true);
    }

    function pointerCancel(event) {
      if (!drag || (drag.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
      finish(false);
    }

    function keyDown(event) {
      if (event.key === "Escape" && drag) {
        event.preventDefault();
        finish(false);
        return;
      }
      if (!event.altKey) return;
      const target = event.target && (event.target.nodeType === 1 ? event.target : event.target.parentElement);
      const handle = target && target.closest(handleSelector);
      const item = handle && handle.closest(itemSelector);
      const container = item && item.closest(containerSelector);
      if (!handle || !item || !container || !root.contains(container)) return;
      const backward = axis === "x" ? event.key === "ArrowLeft" : event.key === "ArrowUp";
      const forward = axis === "x" ? event.key === "ArrowRight" : event.key === "ArrowDown";
      if (!backward && !forward) return;
      event.preventDefault();
      const items = sortableItems(container);
      const fromIndex = items.indexOf(item);
      const toIndex = Math.max(0, Math.min(items.length - 1, fromIndex + (backward ? -1 : 1)));
      if (fromIndex === toIndex || typeof onCommit !== "function") return;
      onCommit({ key: item.dataset.sortKey || "", fromIndex, toIndex, container });
    }

    function click(event) {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }

    function windowBlur() {
      finish(false);
    }

    root.addEventListener("pointerdown", pointerDown);
    root.addEventListener("pointermove", pointerMove, { passive: false });
    root.addEventListener("pointerup", pointerUp);
    root.addEventListener("pointercancel", pointerCancel);
    root.addEventListener("lostpointercapture", pointerCancel);
    root.addEventListener("keydown", keyDown);
    root.addEventListener("click", click, true);
    if (ownerWindow) ownerWindow.addEventListener("blur", windowBlur);
    return {
      destroy() {
        finish(false);
        root.removeEventListener("pointerdown", pointerDown);
        root.removeEventListener("pointermove", pointerMove);
        root.removeEventListener("pointerup", pointerUp);
        root.removeEventListener("pointercancel", pointerCancel);
        root.removeEventListener("lostpointercapture", pointerCancel);
        root.removeEventListener("keydown", keyDown);
        root.removeEventListener("click", click, true);
        if (ownerWindow) ownerWindow.removeEventListener("blur", windowBlur);
      }
    };
  }

  return { normalizeOrder, reorderByIndex, reorderVisibleByIndex, createPointerSortable };
});


// SOURCE: src/ui/styles.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildCreditStyles = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PANEL_STYLES = `
        #mwi-credit-optimizer{--mwi-entry-min-width:300px;--mwi-entry-gap:10px;position:relative;z-index:0;box-sizing:border-box;flex:1;min-width:0;min-height:0;height:100%;overflow-y:auto;overflow-x:hidden;margin:0;padding:12px;background:transparent;color:#f4f5ff;font:14px system-ui,sans-serif;container-type:inline-size}
        #mwi-credit-optimizer[hidden]{display:none} [data-mwi-credit-tab="true"]{user-select:none;pointer-events:auto!important;cursor:pointer!important}
        #mwi-credit-optimizer *{box-sizing:border-box} #mwi-credit-optimizer h3{margin:0 0 5px;font-size:17px}#mwi-credit-optimizer .mwi-plugin-version{margin:0 0 10px;padding:5px 7px;border:1px solid #474969;border-radius:4px;background:#292a46;color:#c9cbeb;font-size:11px;line-height:1.4}.mwi-plugin-version.mwi-update-available{border-color:#d8a33c;background:#463a21;color:#ffe09a;font-weight:700}
        @container (max-width:320px){#mwi-credit-optimizer .mwi-view-tabs-shell :is(.mwi-view-tab,.mwi-settings-trigger){font-size:11px}}
        #mwi-credit-optimizer [data-role="trials-view"] :focus-visible{outline:2px solid #77e1cb;outline-offset:2px}
        #mwi-credit-optimizer .mwi-view-tabs-shell{position:sticky;z-index:20;top:-12px;display:flex;align-items:stretch;gap:0;margin:0 -12px 12px;padding:8px 12px 0;border-bottom:1px solid #383b53;background:#202139}#mwi-credit-optimizer .mwi-view-tabs{display:flex;flex:0 1 auto;min-width:0;overflow-x:auto;scrollbar-width:thin}#mwi-credit-optimizer .mwi-view-tab-item{position:relative;display:block;flex:0 0 auto;touch-action:pan-y;cursor:grab}#mwi-credit-optimizer .mwi-view-tab-item[hidden]{display:none!important}#mwi-credit-optimizer .mwi-view-tab-item:active{cursor:grabbing}#mwi-credit-optimizer :is(.mwi-view-tab,.mwi-settings-trigger){min-height:40px!important;border-radius:0!important;background:transparent!important;color:#c9cbeb!important;padding:6px 10px!important;touch-action:pan-y}#mwi-credit-optimizer .mwi-view-tab-active{border-bottom:2px solid #77e1cb!important;background:transparent!important;color:#a3f0df!important}#mwi-credit-optimizer .mwi-icon-button{position:relative;width:32px;min-width:32px;min-height:32px;padding:0!important;border:1px solid #555875!important;background:#343650!important;color:#fff!important}#mwi-credit-optimizer .mwi-icon-button:before{position:absolute;top:50%;left:50%;width:7px;height:7px;border-top:2px solid currentColor;border-left:2px solid currentColor;content:""}#mwi-credit-optimizer .mwi-icon-up:before{transform:translate(-50%,-35%) rotate(45deg)}#mwi-credit-optimizer .mwi-icon-down:before{transform:translate(-50%,-65%) rotate(225deg)}

        #mwi-credit-optimizer .mwi-settings-panel{min-width:0;margin:-2px 0 10px;border:1px solid #4b5777;border-radius:8px;background:linear-gradient(145deg,#232a43,#25263f);box-shadow:0 8px 20px #0c0d173d;color:#f4f5ff}#mwi-credit-optimizer .mwi-settings-panel[hidden]{display:none!important}#mwi-credit-optimizer .mwi-settings-header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:9px 10px;border-bottom:1px solid #3f4969;background:#212941}#mwi-credit-optimizer .mwi-settings-header>span{display:grid;gap:2px;min-width:0}#mwi-credit-optimizer .mwi-settings-header h3{margin:0;color:#f3fff9;font-size:14px}#mwi-credit-optimizer .mwi-settings-header p{margin:0;color:#aebbd4;font-size:10px;line-height:1.35;overflow-wrap:anywhere}#mwi-credit-optimizer .mwi-settings-close{flex:0 0 auto;width:28px;min-width:28px;min-height:28px!important;padding:0!important;border:1px solid #59607e!important;background:#343650!important;color:#e8e9f8!important;font-size:18px;line-height:1}#mwi-credit-optimizer .mwi-settings-content{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;padding:9px 10px}#mwi-credit-optimizer .mwi-settings-block{min-width:0;padding:8px 0}#mwi-credit-optimizer .mwi-settings-block+.mwi-settings-block{border-top:1px solid #424866}#mwi-credit-optimizer .mwi-settings-block-heading{display:grid;gap:2px;margin:0 0 7px}#mwi-credit-optimizer .mwi-settings-block-heading h4{margin:0;color:#f2f4ff;font-size:12px}#mwi-credit-optimizer .mwi-settings-block-heading p{margin:0;color:#aeb1cf;font-size:10px;line-height:1.4;overflow-wrap:anywhere}#mwi-credit-optimizer .mwi-settings-domains{display:grid;grid-template-columns:minmax(0,1fr);gap:7px}#mwi-credit-optimizer .mwi-settings-domain{min-width:0;margin:0;padding:6px;border:1px solid #3f4665;border-radius:5px;background:#23253d}#mwi-credit-optimizer .mwi-settings-domain legend{padding:0 4px;color:#77f3d0;font-size:10px;font-weight:700}#mwi-credit-optimizer .mwi-settings-domain[data-domain="combat"] legend{color:#8cb9ff}#mwi-credit-optimizer .mwi-settings-options{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:4px}#mwi-credit-optimizer label.mwi-settings-option{display:flex;align-items:center;gap:6px;min-width:0;min-height:30px;padding:4px 6px;border:1px solid transparent;border-radius:4px;background:#2b2d49;color:#e8eafa;font-size:10px;line-height:1.25;cursor:pointer}#mwi-credit-optimizer label.mwi-settings-option:hover{border-color:#59607e;background:#313451}#mwi-credit-optimizer .mwi-settings-option span{min-width:0;overflow-wrap:anywhere}#mwi-credit-optimizer .mwi-settings-shrine-icon{display:flex;flex:0 0 30px;width:30px;height:30px}#mwi-credit-optimizer .mwi-settings-shrine-icon .mwi-building-icon{width:100%;height:100%;margin:0}#mwi-credit-optimizer .mwi-settings-shrine-copy{display:grid;gap:3px;flex:1;min-width:0;text-align:left}#mwi-credit-optimizer .mwi-settings-shrine-name{font-size:11px;line-height:1.35}#mwi-credit-optimizer .mwi-settings-shrine-effects{color:#bfc9df;font-size:10px;line-height:1.4}#mwi-credit-optimizer label.mwi-settings-option:focus-within{outline:2px solid #77f3d0;outline-offset:1px}#mwi-credit-optimizer .mwi-settings-option input[type="checkbox"]{flex:0 0 15px;width:15px;min-width:15px;height:15px;min-height:15px;margin:0;padding:0;accent-color:#43c4ad}#mwi-credit-optimizer .mwi-settings-placeholder{margin:0;padding:7px;border:1px dashed #545a79;border-radius:4px;color:#c6c9df;font-size:10px;line-height:1.35}#mwi-credit-optimizer label.mwi-settings-switch{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0;padding:6px;border-radius:5px;background:#23253d;cursor:pointer}#mwi-credit-optimizer label.mwi-settings-switch+.mwi-settings-switch{margin-top:6px}#mwi-credit-optimizer .mwi-settings-switch-copy{display:grid;gap:2px;min-width:0}#mwi-credit-optimizer .mwi-settings-switch-copy strong{color:#f2f4ff;font-size:11px;overflow-wrap:anywhere}#mwi-credit-optimizer .mwi-settings-switch-copy small{color:#aeb1cf;font-size:9px;line-height:1.35;overflow-wrap:anywhere}#mwi-credit-optimizer input.mwi-settings-switch-input{position:relative;flex:0 0 36px;width:36px;min-width:36px;height:20px;min-height:20px;margin:0;padding:2px;border:1px solid #626784;border-radius:999px;background:#383a54;appearance:none;cursor:pointer;transition:border-color .16s ease,background-color .16s ease}#mwi-credit-optimizer input.mwi-settings-switch-input:before{display:block;width:14px;height:14px;border-radius:50%;background:#c7cae0;box-shadow:0 1px 3px #090a12aa;content:"";transition:transform .16s ease,background-color .16s ease}#mwi-credit-optimizer input.mwi-settings-switch-input:checked{border-color:#77f3d0;background:#2c665d}#mwi-credit-optimizer input.mwi-settings-switch-input:checked:before{transform:translateX(16px);background:#edfffa}#mwi-credit-optimizer .mwi-settings-status{min-height:0;margin:0;padding:0 10px 8px;color:#a9e9dc;font-size:10px;line-height:1.35}#mwi-credit-optimizer .mwi-settings-status:empty{display:none}#mwi-credit-optimizer .mwi-settings-status[data-error="true"]{color:#ff9ca3}
        #mwi-credit-optimizer[data-settings-open="true"] .mwi-settings-panel{margin:0;border:0;border-radius:0;box-shadow:none;background:transparent}
        #mwi-credit-optimizer .mwi-settings-trigger[aria-current="page"]{border-bottom:2px solid #77e1cb!important;color:#a3f0df!important}
        #mwi-credit-optimizer .mwi-settings-close{width:auto;min-width:48px;padding:4px 10px!important;font-size:12px;line-height:1.4}
        #mwi-credit-optimizer .mwi-settings-name{margin:0 0 8px;min-width:0}#mwi-credit-optimizer .mwi-settings-name>label{display:block;margin-bottom:5px;font-size:11px;font-weight:700}#mwi-credit-optimizer .mwi-settings-name-controls{display:flex;flex-wrap:wrap;gap:6px;align-items:center}#mwi-credit-optimizer .mwi-settings-name-controls input{flex:1 1 160px;width:100%;min-width:0;max-width:100%;box-sizing:border-box}#mwi-credit-optimizer .mwi-settings-name-controls button{flex:0 0 auto}#mwi-credit-optimizer .mwi-settings-name p{margin:5px 0 0;color:#aeb1cf;font-size:10px;line-height:1.4;overflow-wrap:anywhere}
        @container (min-width:600px){#mwi-credit-optimizer .mwi-settings-domains{grid-template-columns:repeat(2,minmax(0,1fr))}}@container (max-width:400px){#mwi-credit-optimizer .mwi-settings-content{padding:7px}#mwi-credit-optimizer .mwi-settings-header{padding:8px}#mwi-credit-optimizer label.mwi-settings-switch{align-items:flex-start}}
        @media (prefers-reduced-motion:reduce){#mwi-credit-optimizer input.mwi-settings-switch-input,#mwi-credit-optimizer input.mwi-settings-switch-input:before{transition:none}}
        #mwi-credit-optimizer .mwi-controls{display:flex;gap:8px;align-items:end;flex-wrap:wrap}#mwi-credit-optimizer label{display:grid;gap:4px;color:#d8d8e8}#mwi-credit-optimizer .mwi-number-field{display:grid;gap:4px;min-width:0}#mwi-credit-optimizer .mwi-number-field>label{display:block}#mwi-credit-optimizer .mwi-price-reference{display:flex;flex:0 0 auto;align-items:center;gap:0;height:40px;min-height:40px;border:1px solid #5b5d7b;border-radius:6px;overflow:hidden;background:#292a46}#mwi-credit-optimizer .mwi-price-reference-label{padding:0 7px;color:#c9cbeb;font-size:11px;white-space:nowrap}#mwi-credit-optimizer .mwi-price-reference button{height:38px;min-height:38px;border-radius:0;background:#353653;color:#c9cbeb;padding:0 9px;white-space:nowrap}#mwi-credit-optimizer .mwi-price-reference button+button{border-left:1px solid #5b5d7b}#mwi-credit-optimizer .mwi-price-reference button[data-active="true"]{background:#43c4ad;color:#10201f}#mwi-credit-optimizer .mwi-controls>[data-role="refresh"]{min-height:40px}
        #mwi-credit-optimizer .mwi-number-stepper{display:flex;align-items:stretch;height:40px;min-height:40px;overflow:hidden;border:1px solid #7778b4;border-radius:6px;background:#f4f5ff;box-shadow:inset 0 1px 2px #3e416433}#mwi-credit-optimizer .mwi-number-stepper:focus-within{border-color:#65e3ca;outline:2px solid #65e3ca;outline-offset:2px;box-shadow:0 0 0 4px #77f3d026,inset 0 1px 2px #3e416433}#mwi-credit-optimizer .mwi-number-stepper input{height:38px;min-height:38px;margin:0;border:0;border-radius:0;background:#f4f5ff;color:#1f2030;font-variant-numeric:tabular-nums}#mwi-credit-optimizer .mwi-number-stepper input:focus-visible{outline:0;box-shadow:none}#mwi-credit-optimizer .mwi-target-credit-stepper input{width:112px}#mwi-credit-optimizer .mwi-price-limit-stepper input{flex:0 0 68px;width:68px;min-width:68px;padding:4px 7px}#mwi-credit-optimizer .mwi-number-stepper input[type="number"]{-moz-appearance:textfield;appearance:textfield}#mwi-credit-optimizer .mwi-number-stepper input[type="number"]::-webkit-inner-spin-button,#mwi-credit-optimizer .mwi-number-stepper input[type="number"]::-webkit-outer-spin-button{margin:0;-webkit-appearance:none}#mwi-credit-optimizer .mwi-stepper-buttons{display:grid;flex:0 0 34px;width:34px;min-width:34px;grid-template-rows:repeat(2,minmax(0,1fr));border-left:1px solid #7778b4;background:#373a58}#mwi-credit-optimizer button.mwi-stepper-button{display:grid;place-items:center;width:100%;min-width:0;height:19px;min-height:19px!important;margin:0;padding:0!important;border:0!important;border-radius:0!important;background:#3b3e5e!important;color:#f4f5ff!important;line-height:1;touch-action:none;user-select:none}#mwi-credit-optimizer button.mwi-stepper-button+button{border-top:1px solid #62658a!important}#mwi-credit-optimizer button.mwi-stepper-button:hover{background:#4a4e71!important;color:#fff!important}#mwi-credit-optimizer button.mwi-stepper-button:active,#mwi-credit-optimizer button.mwi-stepper-button[data-pressed="true"]{background:#245149!important;color:#bff8eb!important}#mwi-credit-optimizer button.mwi-stepper-button:focus-visible{z-index:5;outline:2px solid #77f3d0!important;outline-offset:-2px;box-shadow:none!important}#mwi-credit-optimizer .mwi-stepper-button svg{display:block;width:16px;height:10px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
        #mwi-credit-optimizer .mwi-price-limit-control{align-self:end;min-width:0}#mwi-credit-optimizer .mwi-price-limit{display:flex;align-items:center;height:40px;min-height:40px;max-width:100%;border:1px solid #5b5d7b;border-radius:6px;background:#292a46;color:#d8d8e8;font-size:11px;line-height:1.2;white-space:nowrap}#mwi-credit-optimizer .mwi-price-limit>span:not(.mwi-number-stepper){padding-inline:7px}#mwi-credit-optimizer .mwi-price-limit>span:last-child{padding-inline-start:5px}#mwi-credit-optimizer .mwi-price-limit .mwi-number-stepper{height:38px;min-height:38px;border-width:0 1px;border-radius:0;box-shadow:none}#mwi-credit-optimizer .mwi-price-limit .mwi-number-stepper:focus-within{outline:0;box-shadow:none}#mwi-credit-optimizer .mwi-price-limit input{height:38px;min-height:38px;margin:0;border:0;border-radius:0;font-variant-numeric:tabular-nums}#mwi-credit-optimizer .mwi-price-limit input::placeholder{color:#686b83;opacity:1}#mwi-credit-optimizer .mwi-price-limit:focus-within{border-color:#65e3ca;outline:2px solid #65e3ca;outline-offset:2px;box-shadow:0 0 0 4px #77f3d026}#mwi-credit-optimizer .mwi-price-limit-error{display:block;width:100%;max-width:260px;margin-top:4px;padding:4px 6px;border:1px solid #8f4f5b;border-radius:4px;background:#3d2730;color:#ffbdc3;font-size:10px;line-height:1.35;white-space:normal}#mwi-credit-optimizer .mwi-price-limit-error[hidden]{display:none!important}
        @container (max-width:400px){#mwi-credit-optimizer .mwi-price-reference-label{padding-inline:4px}#mwi-credit-optimizer .mwi-price-reference button{padding-inline:5px}}
        #mwi-credit-optimizer input,#mwi-credit-optimizer select{width:112px;min-height:32px;border:1px solid #7778b4;border-radius:4px;padding:4px 8px;background:#f1f2ff;color:#1f2030;font:inherit}
        #mwi-credit-optimizer button{min-height:32px;border:0;border-radius:4px;padding:5px 12px;background:#43c4ad;color:#10201f;font-weight:700;cursor:pointer}
        #mwi-credit-optimizer button:disabled{opacity:.55;cursor:wait} #mwi-credit-optimizer .mwi-status{margin:10px 0;color:#c9cbeb}
        #mwi-credit-optimizer .mwi-credit-grid,#mwi-credit-optimizer .mwi-token-value-list,#mwi-credit-optimizer .mwi-upgrade-plan-list,#mwi-credit-optimizer .mwi-material-list{grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--mwi-entry-min-width)),1fr))}
        #mwi-credit-optimizer .mwi-credit-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:var(--mwi-entry-gap)}
        #mwi-credit-optimizer .mwi-credit-section{min-width:0;border:1px solid #474969;border-top:3px solid var(--mwi-credit-color);border-radius:6px;background:#292a46;overflow:hidden;container-type:inline-size}#mwi-credit-optimizer .mwi-credit-body[hidden],#mwi-credit-optimizer .mwi-token-value-body[hidden]{display:none!important}
        #mwi-credit-optimizer .mwi-credit-heading{display:flex;align-items:center;gap:7px;width:100%;min-height:0!important;border:0;border-radius:0;background:transparent!important;color:#fff!important;padding:8px 9px 6px!important;font:inherit;text-align:left;font-size:13px;font-weight:700;cursor:pointer}.mwi-credit-heading:hover{background:#303151!important}.mwi-credit-heading .mwi-collapse-icon{margin-left:auto;color:#c9cbeb;font-size:15px;line-height:1}
        #mwi-credit-optimizer .mwi-credit-body{max-width:100%;overflow-x:auto;overscroll-behavior-inline:contain;scrollbar-width:thin;scrollbar-color:#5b5d7b #202238}#mwi-credit-optimizer .mwi-credit-heading .mwi-item-icon{width:22px;height:22px;flex:0 0 22px}.mwi-credit-section table{width:100%;min-width:360px;table-layout:fixed;border-collapse:collapse;font-size:11px}#mwi-credit-optimizer .mwi-credit-item-column{width:32%}#mwi-credit-optimizer .mwi-credit-exchange-column{width:27%}#mwi-credit-optimizer .mwi-credit-unit-cost-column{width:24%}#mwi-credit-optimizer .mwi-credit-target-cost-column{width:17%}
        #mwi-credit-optimizer th,#mwi-credit-optimizer td{padding:5px 6px;border-top:1px solid #474969;text-align:right;white-space:nowrap}
        #mwi-credit-optimizer th:first-child,#mwi-credit-optimizer td:first-child{text-align:left} #mwi-credit-optimizer th{color:#bfc2de;font-weight:600}
        #mwi-credit-optimizer .mwi-item{display:flex;align-items:center;gap:5px;min-width:0}.mwi-item-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#mwi-credit-optimizer .mwi-credit-section .mwi-item-name{overflow:visible;text-overflow:clip;white-space:normal;overflow-wrap:anywhere;line-height:1.2}
        #mwi-credit-optimizer .mwi-item-icon{display:inline-block;width:24px;height:24px;flex:0 0 24px;vertical-align:middle}.mwi-item-icon-fallback{border-radius:4px;background:#45476b}#mwi-credit-optimizer .mwi-market-item-link{display:inline-grid;place-items:center;flex:0 0 24px;width:24px;min-width:24px;height:24px;min-height:24px!important;padding:0!important;border:1px solid transparent!important;border-radius:5px!important;background:transparent!important;color:inherit!important;line-height:1;cursor:pointer}#mwi-credit-optimizer .mwi-market-item-link:hover,#mwi-credit-optimizer .mwi-market-item-link:focus-visible{border-color:#77f3d0!important;background:#2d6159!important;outline:none;box-shadow:0 0 0 2px #77f3d033}#mwi-credit-optimizer .mwi-market-item-link .mwi-item-icon{display:block}
        #mwi-credit-optimizer .mwi-cost{color:#77f3d0;font-weight:700} #mwi-credit-optimizer .mwi-empty{padding:8px;color:#ffd17c;font-size:12px}#mwi-credit-optimizer .mwi-token-value-section{margin:10px 0;border:1px solid #3a7b70;border-top:3px solid #43c4ad;border-radius:6px;background:#203b3a;overflow:hidden}#mwi-credit-optimizer .mwi-token-value-heading{border-bottom:1px solid #3a7b70}#mwi-credit-optimizer .mwi-token-value-heading .mwi-item-icon{width:22px;height:22px;flex:0 0 22px}#mwi-credit-optimizer .mwi-token-value-list{display:grid;column-gap:var(--mwi-entry-gap);row-gap:0;margin-inline:-1px}#mwi-credit-optimizer .mwi-token-value-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:8px;min-width:0;padding:8px;border-top:1px solid #315d58}#mwi-credit-optimizer .mwi-token-value-row .mwi-item-icon{width:21px;height:21px;flex:0 0 21px}#mwi-credit-optimizer .mwi-token-value-exchange{color:#d7f6ef;font-size:11px;white-space:nowrap}#mwi-credit-optimizer .mwi-token-value-row .mwi-cost{font-size:12px;white-space:nowrap}#mwi-credit-optimizer .mwi-token-value-unpriced{color:#ffd17c;font-size:11px;white-space:nowrap}
        #mwi-credit-optimizer .mwi-upgrade-preset{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;margin:0 0 12px;padding:10px 11px;border:1px solid #3b8478;border-radius:9px;background:linear-gradient(135deg,#1f403d,#202f48);box-shadow:0 4px 14px #101d1c55}#mwi-credit-optimizer .mwi-upgrade-preset-copy{display:grid;gap:3px;min-width:0}#mwi-credit-optimizer .mwi-upgrade-preset-copy strong{color:#dffaf4;font-size:12px}#mwi-credit-optimizer .mwi-upgrade-preset-copy small{color:#abd5cd;font-size:10px;line-height:1.35}#mwi-credit-optimizer .mwi-upgrade-preset-buttons{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:7px}#mwi-credit-optimizer .mwi-upgrade-preset-buttons button{min-height:29px!important;padding:5px 8px!important;font-size:11px;white-space:nowrap;background:#43c4ad!important;color:#10201f!important}#mwi-credit-optimizer .mwi-upgrade-preset-buttons button[data-domain="combat"]{background:#6ea9ff!important;color:#15233f!important}#mwi-credit-optimizer .mwi-upgrade-preset-buttons button:disabled{background:#4d5968!important;color:#bec4ce!important;cursor:not-allowed}
        @container (max-width:520px){#mwi-credit-optimizer .mwi-upgrade-preset{grid-template-columns:minmax(0,1fr);align-items:stretch}#mwi-credit-optimizer .mwi-upgrade-preset-buttons{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));justify-content:stretch}#mwi-credit-optimizer .mwi-upgrade-preset-buttons button{width:100%;min-width:0}}
        #mwi-credit-optimizer .mwi-upgrade-plan-list{display:grid;gap:var(--mwi-entry-gap)}#mwi-credit-optimizer .mwi-upgrade-plan{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 36px;gap:9px;align-items:end;padding:11px;border:1px solid #45486d;border-radius:8px;background:linear-gradient(135deg,#2c2e4d,#252640);box-shadow:0 4px 13px #13142555}#mwi-credit-optimizer .mwi-upgrade-plan label{min-width:0;text-align:left;justify-items:stretch;font-size:12px}#mwi-credit-optimizer .mwi-upgrade-plan label:first-child{grid-column:1/-1;grid-row:1}#mwi-credit-optimizer .mwi-upgrade-plan label:nth-child(2){grid-column:1;grid-row:2}#mwi-credit-optimizer .mwi-upgrade-plan label:nth-child(3){grid-column:2;grid-row:2}#mwi-credit-optimizer .mwi-upgrade-plan select{width:100%!important;max-width:none;min-width:0}#mwi-credit-optimizer .mwi-remove-plan{grid-column:3;grid-row:2;width:36px;min-width:36px;padding:0!important;font-size:21px;line-height:1;background:#555773!important;color:#fff!important}#mwi-credit-optimizer .mwi-upgrade-actions{display:flex;justify-content:center;gap:9px;margin:12px 0 4px}#mwi-credit-optimizer .mwi-clear-upgrade-plans{background:#a04455!important;color:#fff!important}#mwi-credit-optimizer .mwi-clear-upgrade-plans:hover{background:#bd4d61!important}#mwi-credit-optimizer .mwi-token-budget{display:grid;gap:8px;margin:10px 0 4px;padding:10px 11px;border:1px solid #56597f;border-radius:8px;background:linear-gradient(135deg,#30314f,#292a46)}#mwi-credit-optimizer .mwi-token-budget-heading{display:flex;justify-content:space-between;align-items:start;gap:10px;color:#e8e9f6}#mwi-credit-optimizer .mwi-token-budget-heading>span:first-child{display:grid;gap:2px}#mwi-credit-optimizer .mwi-token-budget-heading strong{font-size:12px}#mwi-credit-optimizer .mwi-token-budget-heading small{color:#bfc2de;font-size:10px;line-height:1.35}#mwi-credit-optimizer .mwi-token-budget-heading>span:last-child{color:#77f3d0;font-size:11px;white-space:nowrap}#mwi-credit-optimizer .mwi-token-budget-inputs{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px}#mwi-credit-optimizer .mwi-token-budget-inputs input[type="range"]{width:100%;min-height:24px;padding:0;border:0;background:transparent;accent-color:#43c4ad}#mwi-credit-optimizer .mwi-token-budget-inputs label{display:flex;align-items:center;gap:5px;color:#c9cbeb;font-size:11px}#mwi-credit-optimizer .mwi-token-budget-inputs input[type="number"]{width:100px;min-height:30px}#mwi-credit-optimizer .mwi-token-credit-plan-toggle{display:grid;grid-template-columns:24px minmax(0,1fr);align-items:center;column-gap:9px;width:100%;margin:9px 0 4px;padding:9px 11px!important;border:1px solid #56597f!important;border-radius:8px!important;background:linear-gradient(135deg,#30314f,#292a46)!important;color:#e8e9f6!important;text-align:left}#mwi-credit-optimizer .mwi-token-credit-plan-toggle[data-active="true"]{border-color:#43c4ad!important;background:linear-gradient(135deg,#20453f,#243e3c)!important;color:#e4fff8!important;box-shadow:0 0 0 1px #43c4ad33}#mwi-credit-optimizer .mwi-token-credit-plan-indicator{display:grid;place-items:center;width:24px;height:24px;border:2px solid #777aa4;border-radius:6px;background:#20213a;color:#10201f;font-size:16px;line-height:1}#mwi-credit-optimizer .mwi-token-credit-plan-toggle[data-active="true"] .mwi-token-credit-plan-indicator{border-color:#77f3d0;background:#77f3d0}#mwi-credit-optimizer .mwi-token-credit-plan-copy{display:grid;gap:2px;min-width:0}#mwi-credit-optimizer .mwi-token-credit-plan-copy strong{font-size:12px}#mwi-credit-optimizer .mwi-token-credit-plan-copy small{color:#bfc2de;font-size:10px;font-weight:500;line-height:1.35}#mwi-credit-optimizer .mwi-token-credit-plan-toggle[data-active="true"] small{color:#bce8de}
        #mwi-credit-optimizer .mwi-material-list{display:grid;gap:var(--mwi-entry-gap);margin-top:12px}.mwi-material-row{position:relative;align-self:start;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;padding:11px;border:1px solid #45486d;border-left:3px solid var(--mwi-material-accent);border-radius:8px;background:linear-gradient(135deg,#292b48,#23243d);box-shadow:0 4px 13px #13142544}.mwi-material-row-token{min-height:0;padding:9px 11px;background:linear-gradient(135deg,#2b2c49,#24253f)}.mwi-material-credit{display:flex;align-items:center;gap:8px;min-width:0}.mwi-material-copy{min-width:0;display:grid;gap:2px}.mwi-material-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#f4f5ff;font-weight:700}.mwi-material-copy small{color:#aeb1d3;font-size:11px}.mwi-material-required{display:grid;justify-items:end;align-content:center;gap:1px;text-align:right}.mwi-material-required small{color:#aeb1d3;font-size:10px}.mwi-material-required strong{color:#77f3d0;font-size:18px;line-height:1.1}.mwi-material-plan{grid-column:1/-1;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto auto;align-items:center;column-gap:10px;border:1px solid #356c63;border-radius:7px;background:linear-gradient(135deg,#1f3e3c,#1d3736);overflow:hidden}.mwi-material-plan-auto{border-color:#b17c32;background:linear-gradient(135deg,#493a22,#3d3325)}.mwi-material-plan-auto .mwi-material-plan-icon{border-color:#d7a64d;background:linear-gradient(135deg,#725425,#5c4525)}.mwi-material-plan-auto .mwi-material-plan-need strong{color:#ffd17c}.mwi-material-plan-item{grid-row:1/-1;display:flex;align-items:center;gap:10px;min-width:0;padding:8px 0 8px 8px}.mwi-material-plan-icon{display:grid!important;place-items:center;flex:0 0 52px!important;width:52px!important;height:52px!important;min-width:52px!important;padding:0!important;border:1px solid #4da496;border-radius:7px;background:linear-gradient(135deg,#306b62,#275a53);box-shadow:inset 0 1px #7bd8c822,0 2px 5px #10232166}.mwi-material-plan-icon .mwi-market-item-link{width:50px!important;height:50px!important;min-width:50px!important;min-height:50px!important;border:0!important;border-radius:7px!important}.mwi-material-plan-icon .mwi-item-icon{width:50px!important;height:50px!important;flex:0 0 50px!important;max-width:50px;max-height:50px;object-fit:contain}.mwi-material-plan-item>span:last-child{min-width:0;display:grid;gap:3px}.mwi-material-plan-item b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e3fbf5;font-size:14px;line-height:1.15}.mwi-material-plan-item small{color:#afd4cd;font-size:12px;line-height:1.15}.mwi-material-plan-need{display:grid;justify-items:end;gap:1px;padding:8px 9px 0 0}.mwi-material-plan-need small{color:#afd4cd;font-size:10px}.mwi-material-plan-need strong{color:#77f3d0;font-size:17px;line-height:1}.mwi-material-plan-rate{grid-column:2;align-self:end;padding:0 9px 9px 0;color:#c5e3dd;font-size:10px;text-align:right;white-space:nowrap}.mwi-material-plan-unavailable{padding:9px;color:#ffd17c;font-size:11px}.mwi-plan-summary{display:flex;flex-wrap:wrap;justify-content:center;gap:5px;margin:12px 0 8px;color:#d7d9ed;font-size:12px}.mwi-plan-summary span:not(.mwi-plan-separator){padding:4px 7px;border:1px solid #45486d;border-radius:999px;background:#292a46}.mwi-plan-separator{display:none}.mwi-upgrade-cost-summary{display:grid;gap:7px;margin:8px 0 10px;padding:11px 12px;border:1px solid #3d8d80;border-radius:8px;background:linear-gradient(135deg,#1d3d3b,#203b3a);box-shadow:0 5px 14px #101d1c55}.mwi-upgrade-cost-title{color:#b7e6dc;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.mwi-upgrade-cost-summary>div:not(.mwi-upgrade-cost-note):not(.mwi-upgrade-cost-title){display:flex;justify-content:space-between;gap:8px;align-items:baseline}.mwi-upgrade-cost-summary span{color:#d7f6ef}.mwi-upgrade-cost-summary strong{color:#77f3d0;font-size:15px;text-align:right}.mwi-upgrade-cost-note{color:#ffd17c;font-size:11px}.mwi-upgrade-auto-token-note{color:#9bead8}.mwi-upgrade-cost-unavailable{color:#ffd17c;border-color:#80663f;background:#3b3323}.mwi-plugin-version .mwi-update-link,#mwi-credit-optimizer .mwi-plugin-footer a{color:#fff;text-decoration:underline;text-underline-offset:2px}.mwi-plugin-version .mwi-update-link:hover,#mwi-credit-optimizer .mwi-plugin-footer a:hover{color:#77f3d0}.mwi-plugin-footer{margin-top:16px;padding:10px 4px 2px;border-top:1px solid #474969;color:#aeb1d3;font-size:12px;line-height:1.6;text-align:center}#mwi-credit-optimizer .mwi-sort-dragging{border-color:#77f3d0!important;box-shadow:0 10px 24px #090a12aa;opacity:.92}#mwi-credit-optimizer .mwi-sort-drop-before:before,#mwi-credit-optimizer .mwi-sort-drop-after:after{position:absolute;right:0;left:0;z-index:9;height:2px;background:#77f3d0;content:""}#mwi-credit-optimizer .mwi-sort-drop-before:before{top:-4px}#mwi-credit-optimizer .mwi-sort-drop-after:after{bottom:-4px}#mwi-credit-optimizer .mwi-view-tab-item.mwi-sort-drop-before:before,#mwi-credit-optimizer .mwi-view-tab-item.mwi-sort-drop-after:after{top:5px;bottom:5px;width:2px;height:auto}#mwi-credit-optimizer .mwi-view-tab-item.mwi-sort-drop-before:before{right:auto;left:-1px}#mwi-credit-optimizer .mwi-view-tab-item.mwi-sort-drop-after:after{right:-1px;left:auto}
        #mwi-credit-optimizer .mwi-material-shortfall{color:#ff737d;font-weight:700}
        #mwi-credit-optimizer .mwi-field-error{color:#ff9ca3!important}
        #mwi-credit-optimizer .mwi-guild-point-history-actions{display:flex;flex-wrap:wrap;flex:0 0 auto;gap:6px}
        #mwi-credit-optimizer .mwi-guild-point-history-actions button{min-height:36px;padding:4px 8px;border:1px solid #535975;background:transparent;color:#cbd1e7;font-size:12px}
        #mwi-credit-optimizer .mwi-guild-point-history-actions button[data-role="reset-guild-point-history"]{border-color:transparent;color:#d7b4bb}
        #mwi-credit-optimizer .mwi-guild-point-history{border-top:1px solid #38635d;color:#c5d9d5;font-size:12px}
        #mwi-credit-optimizer .mwi-guild-point-history>summary{padding:6px 9px;cursor:pointer;user-select:none}
        #mwi-credit-optimizer .mwi-guild-point-manual-form{border-top:1px solid #38635d;background:#203330}
        #mwi-credit-optimizer .mwi-guild-point-table-scroll{overflow:auto;overscroll-behavior:contain}
        #mwi-credit-optimizer .mwi-guild-point-history table{width:100%;min-width:430px;border-collapse:collapse;table-layout:fixed;font-variant-numeric:tabular-nums}
        #mwi-credit-optimizer .mwi-guild-point-history th,#mwi-credit-optimizer .mwi-guild-point-history td{box-sizing:border-box;padding:10px 12px;border-bottom:1px solid #36534f;text-align:left}
        #mwi-credit-optimizer .mwi-guild-point-history thead th{position:sticky;top:0;z-index:1;background:#29443f;color:#abd5cd;font-weight:600}
        #mwi-credit-optimizer .mwi-guild-point-history th:first-child{width:31%}
        #mwi-credit-optimizer .mwi-guild-point-history th:nth-child(2){width:42%}
        #mwi-credit-optimizer .mwi-guild-point-history th:last-child{width:27%}
        #mwi-credit-optimizer .mwi-guild-point-history tbody th{background:#24273d;color:#cbd3e6;font-weight:400}
        #mwi-credit-optimizer .mwi-guild-point-history tbody td{background:#24273d}
        #mwi-credit-optimizer .mwi-guild-point-history tbody tr[data-source="manual"] :is(th,td){background:#253b3a}
        #mwi-credit-optimizer .mwi-guild-point-history tbody tr[data-current-week="true"] :is(th,td){border-top:1px solid #67b9a9;background:#1d3534}
        #mwi-credit-optimizer .mwi-guild-point-current-label{display:block;margin-top:2px;color:#77f3d0;font-size:12px;font-weight:700}
        #mwi-credit-optimizer .mwi-guild-point-history tr[data-next-week="true"] td:last-child{white-space:normal}
        #mwi-credit-optimizer .mwi-guild-point-history input{box-sizing:border-box;width:100%;min-width:0;height:36px;padding:5px 7px;border:1px solid #4d6966;border-radius:4px;background:#171a2b;color:#eef5ff;font:14px ui-monospace,SFMono-Regular,Menlo,monospace}
        #mwi-credit-optimizer .mwi-guild-point-history input::placeholder{color:#9ea9bd;opacity:1}
        #mwi-credit-optimizer .mwi-guild-point-readonly{display:block;padding:4px 7px;color:#dffff7;font:600 14px ui-monospace,SFMono-Regular,Menlo,monospace}
        #mwi-credit-optimizer .mwi-guild-point-tracked-value{display:flex;align-items:center;justify-content:space-between;gap:5px;min-width:0}
        #mwi-credit-optimizer .mwi-guild-point-tracked-value .mwi-guild-point-readonly{min-width:0;padding-inline-start:0}
        #mwi-credit-optimizer .mwi-guild-point-tracked-value button{flex:0 0 auto;min-height:32px;padding:2px 7px;border-color:#655f79;background:#34344c;color:#e8e9f8;font-size:12px}
        #mwi-credit-optimizer .mwi-guild-point-history tbody tr[data-source="trackedEditing"] :is(th,td){background:#3b3428}
        #mwi-credit-optimizer .mwi-guild-point-history tbody tr[data-source="manualOverride"] :is(th,td){background:#3a3037}
        #mwi-credit-optimizer .mwi-guild-point-history td small{color:#91bbb4}
        #mwi-credit-optimizer .mwi-guild-point-manual-footer{display:flex;align-items:center;justify-content:space-between;gap:9px;padding:8px 9px}
        #mwi-credit-optimizer .mwi-guild-point-manual-footer button{flex:0 0 auto;min-height:36px;padding:4px 9px;font-size:12px}
        #mwi-credit-optimizer .mwi-guild-point-manual-hint,#mwi-credit-optimizer .mwi-guild-point-history-empty{min-width:0;margin:0;color:#91bbb4;line-height:1.4}
        #mwi-credit-optimizer .mwi-guild-point-dialog-layer{position:fixed;z-index:80;inset:0;display:grid;place-items:center;padding:16px;background:#0d101bc7;overscroll-behavior:contain}
        #mwi-credit-optimizer .mwi-guild-point-dialog{display:grid;width:min(410px,calc(100vw - 32px));max-height:calc(100dvh - 32px);grid-template-columns:34px minmax(0,1fr);gap:10px;padding:16px;border-radius:12px;background:#292a43;box-shadow:0 18px 48px #070812cc;color:#eef5ff;overflow:auto}
        #mwi-credit-optimizer .mwi-guild-point-dialog-mark{width:30px;height:30px;fill:#5c4828;stroke:#ffd17c;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
        #mwi-credit-optimizer .mwi-guild-point-dialog-mark circle{fill:#ffd17c;stroke:none}
        #mwi-credit-optimizer .mwi-guild-point-dialog-copy{display:grid;gap:7px;min-width:0}
        #mwi-credit-optimizer .mwi-guild-point-dialog-copy h4{margin:0;color:#fff4cc;font-size:14px;line-height:1.3}
        #mwi-credit-optimizer .mwi-guild-point-dialog-copy p,#mwi-credit-optimizer .mwi-guild-point-dialog-copy small{margin:0;line-height:1.5;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-guild-point-dialog-copy p{color:#eef1fb;font-size:12px}
        #mwi-credit-optimizer .mwi-guild-point-dialog-copy small{color:#bbc3d8;font-size:12px}
        #mwi-credit-optimizer .mwi-guild-point-dialog-actions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:7px;margin-top:4px}
        #mwi-credit-optimizer .mwi-guild-point-dialog-actions button{min-height:34px;padding:6px 11px}
        #mwi-credit-optimizer .mwi-guild-point-dialog-actions .mwi-guild-point-dialog-confirm{background:#73572c;color:#fff4cc}
        @container (max-width:520px){#mwi-credit-optimizer .mwi-guild-point-history-actions{justify-content:flex-end}#mwi-credit-optimizer .mwi-guild-point-manual-footer{align-items:stretch;flex-direction:column}#mwi-credit-optimizer .mwi-guild-point-manual-footer button{align-self:flex-end}}
        #mwi-credit-optimizer .mwi-token-credit-plan-toggle[data-active="mixed"]{border-color:#d8a33c!important;background:linear-gradient(135deg,#493f2a,#353147)!important;color:#fff4d4!important;box-shadow:0 0 0 1px #d8a33c33}#mwi-credit-optimizer .mwi-token-credit-plan-toggle[data-active="mixed"] .mwi-token-credit-plan-indicator{border-color:#ffd17c;background:#ffd17c;color:#332814}#mwi-credit-optimizer .mwi-material-copy{flex:1 1 auto}#mwi-credit-optimizer .mwi-material-exchange-mode{flex:0 0 auto;min-height:26px!important;padding:4px 7px!important;border:1px solid #66698f!important;border-radius:999px!important;background:#353653!important;color:#dfe1f4!important;font-size:10px;line-height:1.1;white-space:nowrap}#mwi-credit-optimizer .mwi-material-exchange-mode:hover{border-color:#77f3d0!important}#mwi-credit-optimizer .mwi-material-exchange-mode[data-active="true"]{border-color:#43c4ad!important;background:#245149!important;color:#dffff7!important;box-shadow:0 0 0 1px #43c4ad22}/* Compact shrine planner and aligned result rows. */


        #mwi-credit-optimizer .mwi-upgrade-planner{margin:0 0 9px;border:1px solid #4b4f75;border-radius:9px;background:#242641;overflow:hidden}
        #mwi-credit-optimizer .mwi-upgrade-preset{grid-template-columns:minmax(170px,1fr) auto;gap:7px;margin:0;padding:7px 8px;border:0;border-bottom:1px solid #3b8478;border-radius:0;background:linear-gradient(135deg,#1f403d,#202f48);box-shadow:none}
        #mwi-credit-optimizer .mwi-upgrade-preset-copy{display:flex;align-items:baseline;flex-wrap:wrap;gap:3px 9px}
        #mwi-credit-optimizer .mwi-upgrade-preset-buttons button{min-height:28px!important;padding:4px 8px!important}
        #mwi-credit-optimizer .mwi-upgrade-plan-list{display:grid;grid-template-columns:minmax(0,1fr);gap:0}
        #mwi-credit-optimizer .mwi-upgrade-plan-columns,#mwi-credit-optimizer .mwi-upgrade-plan{display:grid;grid-template-columns:minmax(140px,1.5fr) minmax(70px,.65fr) 18px minmax(70px,.65fr) 32px;gap:6px}
        #mwi-credit-optimizer .mwi-upgrade-plan-columns{align-items:end;padding:4px 8px 2px;border-bottom:1px solid #3e4264;background:#252742;color:#aeb1d3;font-size:10px}
        #mwi-credit-optimizer .mwi-upgrade-plan{align-items:center;padding:6px 8px;border:0;border-bottom:1px solid #3e4264;border-radius:0;background:#282a46;box-shadow:none}
        #mwi-credit-optimizer .mwi-upgrade-plan label{min-width:0;font-size:11px}
        #mwi-credit-optimizer .mwi-upgrade-field-label{display:none}
        #mwi-credit-optimizer .mwi-upgrade-plan label.mwi-upgrade-plan-shrine{grid-column:1;grid-row:1}
        #mwi-credit-optimizer .mwi-upgrade-plan label.mwi-upgrade-plan-start{grid-column:2;grid-row:1}
        #mwi-credit-optimizer .mwi-upgrade-level-arrow{grid-column:3;grid-row:1;align-self:center;justify-self:center;color:#aeb2d0}
        #mwi-credit-optimizer .mwi-upgrade-plan label.mwi-upgrade-plan-target{grid-column:4;grid-row:1}
        #mwi-credit-optimizer .mwi-upgrade-plan select{width:100%!important;min-height:31px;max-width:none;min-width:0}
        #mwi-credit-optimizer .mwi-remove-plan{grid-column:5;grid-row:1;width:32px;min-width:32px;min-height:31px;padding:0!important;border:1px solid #74414b!important;border-radius:6px!important;background:#56323b!important;color:#ffdce2!important;font-size:18px;line-height:1}
        #mwi-credit-optimizer .mwi-upgrade-actions{display:flex;justify-content:space-between;align-items:center;gap:9px;margin:0;padding:7px 9px;background:#292b48}
        #mwi-credit-optimizer .mwi-upgrade-actions small{color:#bfc2de;font-size:10px}
        #mwi-credit-optimizer .mwi-upgrade-actions>span{display:flex;gap:7px}
        #mwi-credit-optimizer .mwi-upgrade-actions button{min-height:29px!important;padding:4px 9px!important;font-size:11px}
        #mwi-credit-optimizer .mwi-token-budget{display:grid;grid-template-columns:minmax(150px,.7fr) minmax(220px,1.5fr) auto;align-items:center;gap:8px;margin:0 0 7px;padding:7px 9px}
        #mwi-credit-optimizer .mwi-token-budget-heading{display:grid;gap:2px;min-width:0}
        #mwi-credit-optimizer .mwi-token-budget-inputs{grid-template-columns:minmax(54px,1fr) auto auto;gap:8px}
        #mwi-credit-optimizer .mwi-token-budget-range-wrap{position:relative;display:grid;align-items:center;min-width:0}
        #mwi-credit-optimizer .mwi-token-budget-inputs input[type="range"]{position:relative;z-index:1}
        #mwi-credit-optimizer .mwi-token-budget-snap-points{position:absolute;z-index:2;left:8px;right:8px;top:50%;height:0;pointer-events:none}
        #mwi-credit-optimizer .mwi-token-budget-snap-points i{position:absolute;left:var(--mwi-snap-position);width:4px;height:4px;border:1px solid #d6d8eb;border-radius:50%;background:#555873;box-shadow:0 0 0 1px #20213a;transform:translate(-50%,-50%)}
        #mwi-credit-optimizer .mwi-token-budget-percent{display:inline-grid;place-items:center;min-width:38px;padding:3px 5px;border:1px solid #686b92;border-radius:999px;background:#252640;color:#dfe1f4;font-size:10px;font-weight:700;line-height:1.2;font-variant-numeric:tabular-nums}
        #mwi-credit-optimizer .mwi-token-budget-percent[data-snapped="true"]{border-color:#d8a33c;background:#493f2a;color:#ffe09a}
        #mwi-credit-optimizer .mwi-token-budget-available{justify-self:end;color:#77f3d0;font-size:11px;white-space:nowrap}
        #mwi-credit-optimizer .mwi-status[data-role="upgrade-status"]{margin:7px 0 3px;color:#c9cbeb;font-size:11px;text-align:center}
        #mwi-credit-optimizer .mwi-plan-summary{justify-content:flex-start;gap:5px;margin:6px 0}
        #mwi-credit-optimizer .mwi-upgrade-cost-summary{display:flex;align-items:center;flex-wrap:wrap;gap:6px 18px;margin:7px 0;padding:8px 10px;box-shadow:none}
        #mwi-credit-optimizer .mwi-upgrade-cost-summary>div:not(.mwi-upgrade-cost-note):not(.mwi-upgrade-cost-title){display:flex;align-items:baseline;gap:6px}
        #mwi-credit-optimizer .mwi-upgrade-cost-summary strong{font-size:14px}
        #mwi-credit-optimizer .mwi-upgrade-cost-note{flex:0 1 auto}
        #mwi-credit-optimizer .mwi-material-list{display:grid;grid-template-columns:minmax(0,1fr);gap:7px;margin-top:7px}
        #mwi-credit-optimizer .mwi-material-row{display:grid;grid-template-columns:minmax(125px,1.05fr) 62px 58px minmax(280px,1.8fr);align-items:center;gap:5px;padding:6px 7px;box-shadow:none}
        #mwi-credit-optimizer .mwi-material-row-token{min-height:0;padding:7px 8px}
        #mwi-credit-optimizer .mwi-material-credit{grid-column:1;min-width:0}
        #mwi-credit-optimizer .mwi-material-credit>.mwi-market-item-link{width:32px;min-width:32px;height:32px;min-height:32px!important}
        #mwi-credit-optimizer .mwi-material-credit>.mwi-market-item-link .mwi-item-icon{width:30px;height:30px;flex-basis:30px}
        #mwi-credit-optimizer .mwi-material-name{font-size:13px}
        #mwi-credit-optimizer .mwi-material-required{grid-column:2}
        #mwi-credit-optimizer .mwi-material-required strong{font-size:16px}
        #mwi-credit-optimizer .mwi-material-exchange-mode,#mwi-credit-optimizer .mwi-material-exchange-mode-spacer{grid-column:3;justify-self:start}
        #mwi-credit-optimizer .mwi-material-plans{grid-column:4;display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:5px;min-width:0}
        #mwi-credit-optimizer .mwi-material-plan{grid-column:auto;min-width:0;column-gap:7px}
        #mwi-credit-optimizer .mwi-material-plan-item{gap:7px;padding:5px 0 5px 5px}
        #mwi-credit-optimizer .mwi-material-plan-icon{flex:0 0 40px!important;width:40px!important;height:40px!important;min-width:40px!important}
        #mwi-credit-optimizer .mwi-material-plan-icon .mwi-market-item-link{width:38px!important;height:38px!important;min-width:38px!important;min-height:38px!important}
        #mwi-credit-optimizer .mwi-material-plan-icon .mwi-item-icon{width:38px!important;height:38px!important;flex:0 0 38px!important;max-width:38px;max-height:38px}
        #mwi-credit-optimizer .mwi-material-plan-item b{font-size:12px}
        #mwi-credit-optimizer .mwi-material-plan-item small{font-size:10px}
        #mwi-credit-optimizer .mwi-material-plan-need{padding:5px 6px 0 0}
        #mwi-credit-optimizer .mwi-material-plan-need strong{font-size:15px}
        #mwi-credit-optimizer .mwi-material-plan-rate{padding:0 6px 6px 0}
        #mwi-credit-optimizer .mwi-material-plan-covered{align-self:center;color:#9bdab8;font-size:11px}
        @container (max-width:650px){#mwi-credit-optimizer .mwi-plan-summary{display:none}}
        @container (max-width:520px){#mwi-credit-optimizer .mwi-token-budget{grid-template-columns:minmax(0,1fr) minmax(220px,1.2fr)}#mwi-credit-optimizer .mwi-token-budget-available{grid-column:1/-1;justify-self:start}#mwi-credit-optimizer .mwi-plan-summary{display:none}#mwi-credit-optimizer .mwi-material-row{grid-template-columns:minmax(125px,1fr) 62px 58px}#mwi-credit-optimizer .mwi-material-plans{grid-column:1/-1}}
        @container (max-width:400px){#mwi-credit-optimizer .mwi-upgrade-preset{grid-template-columns:minmax(0,1fr);align-items:stretch}#mwi-credit-optimizer .mwi-upgrade-preset-copy strong{display:none}#mwi-credit-optimizer .mwi-upgrade-preset-buttons{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));justify-content:stretch}#mwi-credit-optimizer .mwi-upgrade-preset-buttons button{width:100%;min-width:0;padding-inline:4px!important}#mwi-credit-optimizer .mwi-upgrade-plan-columns{display:none}#mwi-credit-optimizer .mwi-upgrade-plan{grid-template-columns:minmax(0,1fr) 18px minmax(0,1fr) 32px;align-items:end}#mwi-credit-optimizer .mwi-upgrade-field-label{display:block}#mwi-credit-optimizer .mwi-upgrade-plan label.mwi-upgrade-plan-shrine{grid-column:1/4;grid-row:1}#mwi-credit-optimizer .mwi-upgrade-plan label.mwi-upgrade-plan-start{grid-column:1;grid-row:2}#mwi-credit-optimizer .mwi-upgrade-level-arrow{display:block;grid-column:2;grid-row:2}#mwi-credit-optimizer .mwi-upgrade-plan label.mwi-upgrade-plan-target{grid-column:3;grid-row:2}#mwi-credit-optimizer .mwi-remove-plan{grid-column:4;grid-row:1}#mwi-credit-optimizer .mwi-upgrade-actions{align-items:center;flex-direction:row}#mwi-credit-optimizer .mwi-upgrade-actions>span{display:flex}#mwi-credit-optimizer .mwi-token-budget{grid-template-columns:minmax(0,1fr) auto}#mwi-credit-optimizer .mwi-token-budget-heading{grid-column:1;grid-row:1}#mwi-credit-optimizer .mwi-token-budget-inputs{grid-column:1/-1;grid-row:2}#mwi-credit-optimizer .mwi-token-budget-available{grid-column:2;grid-row:1;align-self:start}#mwi-credit-optimizer .mwi-upgrade-cost-summary{align-items:flex-start;flex-direction:column;gap:4px;padding:6px 7px}#mwi-credit-optimizer .mwi-material-row{grid-template-columns:minmax(0,1fr) auto}#mwi-credit-optimizer .mwi-material-required{grid-column:2;grid-row:1}#mwi-credit-optimizer .mwi-material-exchange-mode,#mwi-credit-optimizer .mwi-material-exchange-mode-spacer{grid-column:1/-1}#mwi-credit-optimizer .mwi-material-plans{grid-column:1/-1}#mwi-credit-optimizer .mwi-material-plan{grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto auto}#mwi-credit-optimizer .mwi-material-plan-item{grid-row:1/-1}#mwi-credit-optimizer .mwi-material-plan-need{grid-column:2;justify-items:end;padding:5px 6px 0 0}#mwi-credit-optimizer .mwi-material-plan-rate{grid-column:2;padding:0 6px 6px 0;text-align:right}}
        @container (max-width:650px){#mwi-credit-optimizer .mwi-token-budget{grid-template-columns:minmax(0,1fr) auto}#mwi-credit-optimizer .mwi-token-budget-heading{grid-column:1;grid-row:1}#mwi-credit-optimizer .mwi-token-budget-inputs{grid-column:1/-1;grid-row:2}#mwi-credit-optimizer .mwi-token-budget-available{grid-column:2;grid-row:1;align-self:start;justify-self:end}}
        @container (max-width:400px){#mwi-credit-optimizer .mwi-token-budget-inputs input[type="number"]{width:76px}#mwi-credit-optimizer .mwi-token-budget-inputs label>span{display:none}#mwi-credit-optimizer .mwi-token-budget-percent{min-width:34px;padding-inline:4px}}
        #mwi-credit-optimizer .mwi-guild-point-history tbody tr:hover :is(th,td){background:#303d4a}

        #mwi-credit-optimizer [data-role="construction-view"]{font-size:14px;line-height:1.55}
        #mwi-credit-optimizer .mwi-guild-point-history{font-size:14px;line-height:1.55}
        #mwi-credit-optimizer .mwi-guild-point-history>summary{padding:12px 14px}
        #mwi-credit-optimizer .mwi-guild-point-history td small{font-size:12px}
        #mwi-credit-optimizer .mwi-guild-point-tracked-value{flex-wrap:wrap}
        #mwi-credit-optimizer .mwi-guild-point-manual-hint{font-size:12px}/* Shrine route workspace: one visual signature, compact utility controls, and explicit overflow safety. */


        #mwi-credit-optimizer{
          --mwi-void:#171827;
          --mwi-orbit:#242640;
          --mwi-panel:#2a2c49;
          --mwi-mint:#43c4ad;
          --mwi-mint-data:#77f3d0;
          --mwi-amber:#e2b45e;
          --mwi-danger:#b64b63;
        }
        #mwi-credit-optimizer :is(button,input,select):focus-visible{
          position:relative;
          z-index:4;
          outline:2px solid var(--mwi-mint-data);
          outline-offset:2px;
          box-shadow:0 0 0 4px #77f3d026;
        }
        #mwi-credit-optimizer .mwi-upgrade-planner{
          border-color:#4a4e77;
          border-radius:10px;
          background:linear-gradient(180deg,#262842 0%,#22243b 100%);
          box-shadow:0 8px 22px #0d0e1840;
        }
        #mwi-credit-optimizer .mwi-upgrade-preset{
          grid-template-columns:minmax(150px,1fr) auto;
          min-width:0;
          padding:7px 8px;
          border-bottom-color:#3d766e;
          background:linear-gradient(105deg,#203c3a 0%,#242944 58%,#242640 100%);
        }
        #mwi-credit-optimizer .mwi-upgrade-preset-copy{
          min-width:0;
          gap:2px 9px;
        }
        #mwi-credit-optimizer .mwi-upgrade-preset-copy strong{
          color:#ebfff9;
          font-family:ui-rounded,"SF Pro Rounded","PingFang SC",system-ui,sans-serif;
          font-size:11px;
          letter-spacing:.02em;
        }
        #mwi-credit-optimizer .mwi-upgrade-preset-copy small{
          min-width:0;
          color:#a9d6cc;
          overflow-wrap:anywhere;
        }
        #mwi-credit-optimizer .mwi-upgrade-preset-buttons{
          min-width:0;
          gap:6px;
        }
        #mwi-credit-optimizer .mwi-upgrade-preset-buttons button{
          min-width:0;
          min-height:28px!important;
          padding:4px 8px!important;
          border:1px solid #61d5c2!important;
          background:#2c665d!important;
          color:#eafff9!important;
          font-size:10px;
          line-height:1.2;
          white-space:normal;
          overflow-wrap:anywhere;
        }
        #mwi-credit-optimizer .mwi-upgrade-preset-buttons button[data-domain="combat"]{
          border-color:#6ea9ff!important;
          background:#344f7d!important;
          color:#eef5ff!important;
        }
        #mwi-credit-optimizer .mwi-upgrade-plan-columns,#mwi-credit-optimizer .mwi-upgrade-plan{
          grid-template-columns:minmax(108px,1.6fr) minmax(54px,.7fr) 12px minmax(54px,.7fr) 30px;
          gap:5px;
        }
        #mwi-credit-optimizer .mwi-upgrade-plan-columns{
          position:relative;
          z-index:1;
          min-width:0;
          padding:4px 7px 3px;
          border-bottom-color:#414568;
          background:#242641;
          font-size:9px;
          letter-spacing:.03em;
        }
        #mwi-credit-optimizer .mwi-upgrade-plan{
          position:relative;
          z-index:1;
          min-width:0;
          padding:5px 7px;
          border-bottom-color:#3c405f;
          background:#292b47e8;
          transition:background-color .16s ease;
        }
        #mwi-credit-optimizer .mwi-upgrade-plan:hover,#mwi-credit-optimizer .mwi-upgrade-plan:focus-within{
          background:#303250;
        }
        #mwi-credit-optimizer .mwi-upgrade-plan label{
          min-width:0;
          gap:2px;
        }
        #mwi-credit-optimizer .mwi-upgrade-field-label{display:none}
        #mwi-credit-optimizer .mwi-upgrade-plan label.mwi-upgrade-plan-shrine{grid-column:1;grid-row:1}
        #mwi-credit-optimizer .mwi-upgrade-plan label.mwi-upgrade-plan-start{grid-column:2;grid-row:1}
        #mwi-credit-optimizer .mwi-upgrade-level-arrow{display:block;grid-column:3;grid-row:1}
        #mwi-credit-optimizer .mwi-upgrade-plan label.mwi-upgrade-plan-target{grid-column:4;grid-row:1}
        #mwi-credit-optimizer .mwi-remove-plan{grid-column:5;grid-row:1}
        #mwi-credit-optimizer .mwi-upgrade-plan select{
          min-width:0;
          min-height:30px;
          padding:3px 5px;
          border-color:#7478ad;
          border-radius:5px;
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap;
          font-size:11px;
          line-height:1.2;
        }
        #mwi-credit-optimizer .mwi-upgrade-level-arrow{
          color:#9fa5d4;
          font-size:13px;
        }
        #mwi-credit-optimizer .mwi-remove-plan{
          width:30px;
          min-width:30px;
          min-height:30px;
          border-color:#75404c!important;
          background:#56323c!important;
          color:#ffe4e8!important;
          font-size:16px;
          transition:background-color .16s ease,transform .16s ease;
        }
        #mwi-credit-optimizer .mwi-remove-plan:hover{
          background:#713c48!important;
          transform:translateY(-1px);
        }
        #mwi-credit-optimizer .mwi-upgrade-actions{
          min-width:0;
          padding:6px 8px;
          border-top:1px solid #353958;
          background:#252742;
        }
        #mwi-credit-optimizer .mwi-upgrade-actions small{
          min-width:0;
          overflow-wrap:anywhere;
        }
        #mwi-credit-optimizer .mwi-upgrade-actions>span{min-width:0;flex:0 0 auto}
        #mwi-credit-optimizer .mwi-upgrade-actions button{
          min-width:0;
          min-height:28px!important;
          line-height:1.2;
          white-space:normal;
        }
        #mwi-credit-optimizer .mwi-token-budget{
          border-color:#4d5279;
          background:linear-gradient(105deg,#292b48,#242640);
          box-shadow:0 5px 16px #0d0e182b;
        }
        #mwi-credit-optimizer .mwi-token-budget-heading strong{
          font-family:ui-rounded,"SF Pro Rounded","PingFang SC",system-ui,sans-serif;
        }
        #mwi-credit-optimizer .mwi-token-budget-percent,#mwi-credit-optimizer .mwi-token-budget-inputs input[type="number"],#mwi-credit-optimizer .mwi-upgrade-cost-summary strong,#mwi-credit-optimizer .mwi-material-required strong,#mwi-credit-optimizer .mwi-material-plan-need strong{
          font-family:inherit;
          font-style:normal;
          font-variant-numeric:tabular-nums;
          font-feature-settings:"tnum" 1;
        }
        #mwi-credit-optimizer .mwi-upgrade-cost-summary{
          border-color:#3c857a;
          background:linear-gradient(105deg,#1f3e3b,#203836);
        }
        #mwi-credit-optimizer .mwi-material-row{
          background:linear-gradient(105deg,#292b48,#242640);
        }
        #mwi-credit-optimizer .mwi-shrine-guide-route{
          display:grid;
          grid-template-columns:auto minmax(0,1fr);
          align-items:center;
          gap:9px;
          margin:0 0 7px;
          padding:7px 9px;
          border:1px solid #4b4f75;
          border-radius:8px;
          background:linear-gradient(105deg,#282a46,#22243b);
        }
        #mwi-credit-optimizer .mwi-shrine-guide-toggle{
          display:flex;
          align-items:center;
          gap:6px;
          min-height:29px!important;
          padding:4px 9px!important;
          border:1px solid #65698f!important;
          background:#353752!important;
          color:#e3e5f7!important;
          white-space:nowrap;
        }
        #mwi-credit-optimizer .mwi-shrine-guide-route[data-active="true"] .mwi-shrine-guide-toggle{
          border-color:#63e6c8!important;
          background:#245149!important;
          color:#eafff9!important;
        }
        #mwi-credit-optimizer .mwi-shrine-guide-beacon{
          width:8px;
          height:8px;
          border:1px solid #a9acc9;
          border-radius:50%;
          background:#5c5f7e;
          box-shadow:0 0 0 3px #5c5f7e24;
        }
        #mwi-credit-optimizer .mwi-shrine-guide-route[data-active="true"] .mwi-shrine-guide-beacon{
          border-color:#c9fff2;
          background:#63e6c8;
          box-shadow:0 0 0 3px #63e6c82e,0 0 12px #63e6c866;
        }
        #mwi-credit-optimizer .mwi-shrine-guide-copy{display:grid;gap:2px;min-width:0}
        #mwi-credit-optimizer .mwi-shrine-guide-copy strong{overflow:hidden;color:#f2f4ff;font-size:11px;text-overflow:ellipsis;white-space:nowrap}
        #mwi-credit-optimizer .mwi-shrine-guide-copy small{min-width:0;color:#b9bdd9;font-size:10px;line-height:1.35;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-shrine-guide-route[data-status="set_quantity"]{border-color:#d7a64d;background:linear-gradient(105deg,#3d3425,#292a46)}
        #mwi-credit-optimizer .mwi-shrine-guide-route[data-status="complete"]{border-color:#4da496;background:linear-gradient(105deg,#203e3a,#252742)}
        @container (max-width:400px){
          #mwi-credit-optimizer .mwi-upgrade-preset{
            grid-template-columns:minmax(0,1fr);
            gap:6px;
          }
          #mwi-credit-optimizer .mwi-upgrade-preset-copy strong{display:none}
          #mwi-credit-optimizer .mwi-upgrade-preset-buttons{
            display:grid;
            grid-template-columns:repeat(2,minmax(0,1fr));
          }
          #mwi-credit-optimizer .mwi-upgrade-plan-columns{display:none}
          #mwi-credit-optimizer .mwi-shrine-guide-route{grid-template-columns:minmax(0,1fr)}
          #mwi-credit-optimizer .mwi-shrine-guide-toggle{justify-content:center;width:100%}
        }
        @container (max-width:350px){
          #mwi-credit-optimizer .mwi-upgrade-plan{
            grid-template-columns:minmax(0,1fr) 12px minmax(0,1fr) 30px;
            align-items:end;
            padding-block:6px;
          }
          #mwi-credit-optimizer .mwi-upgrade-field-label{
            display:block;
            min-width:0;
            overflow:hidden;
            color:#b7bad6;
            font-size:9px;
            line-height:1.1;
            text-overflow:ellipsis;
            white-space:nowrap;
          }
          #mwi-credit-optimizer .mwi-upgrade-plan label.mwi-upgrade-plan-shrine{grid-column:1/4;grid-row:1}
          #mwi-credit-optimizer .mwi-upgrade-plan label.mwi-upgrade-plan-start{grid-column:1;grid-row:2}
          #mwi-credit-optimizer .mwi-upgrade-level-arrow{display:block;grid-column:2;grid-row:2}
          #mwi-credit-optimizer .mwi-upgrade-plan label.mwi-upgrade-plan-target{grid-column:3;grid-row:2}
          #mwi-credit-optimizer .mwi-remove-plan{grid-column:4;grid-row:1}
          #mwi-credit-optimizer .mwi-upgrade-actions{
            align-items:flex-start;
            flex-direction:column;
            gap:6px;
          }
          #mwi-credit-optimizer .mwi-upgrade-actions>span{width:100%;display:grid;grid-template-columns:1fr auto}
          #mwi-credit-optimizer .mwi-upgrade-actions button{width:100%}
        }
        @media (prefers-reduced-motion:reduce){
          #mwi-credit-optimizer .mwi-upgrade-plan,#mwi-credit-optimizer .mwi-remove-plan{transition:none}
        }
        #mwi-credit-optimizer :is(.mwi-view-tab,.mwi-settings-trigger){border-bottom:2px solid transparent!important;white-space:nowrap;font-size:13px;line-height:1.4;transition:color .15s ease,background-color .15s ease}
        #mwi-credit-optimizer .mwi-view-tab-active{border-bottom-color:#77e1cb!important}
        #mwi-credit-optimizer :is(.mwi-view-tab,.mwi-settings-trigger):hover{color:#fff!important;background:#ffffff08!important}
        #mwi-credit-optimizer .mwi-view-tabs-shell button:focus-visible{outline:2px solid #77e1cb!important;outline-offset:-3px}
        #mwi-credit-optimizer .mwi-view-tabs-shell .mwi-settings-trigger{flex:0 0 auto;width:auto;height:auto;align-self:stretch;white-space:nowrap}
        #mwi-credit-optimizer .mwi-settings-trigger[aria-expanded="true"]{border-bottom-color:#77e1cb!important;color:#a3f0df!important}

        @media (prefers-reduced-motion:reduce){#mwi-credit-optimizer :is(.mwi-view-tab,.mwi-settings-trigger){transition:none}}
        @container (max-width:480px){
          #mwi-credit-optimizer .mwi-view-tabs-shell{padding-top:4px}
          #mwi-credit-optimizer :is(.mwi-view-tab,.mwi-settings-trigger){
            padding:8px 4px!important;
            font-size:12px;
          }

        }

        /* Construction workspace. Scoped tokens and one responsive rule set. */
        #mwi-credit-optimizer [data-role="construction-view"]{--build-surface:#24273b;--build-field:#191c2e;--build-line:#41465f;--build-text:#edf0fa;--build-muted:#b7bfd4;--build-accent:#91dfcb;--build-warning:#e9c487;--build-danger:#ffa7b5;color:var(--build-text);font:14px/1.45 system-ui,-apple-system,"Microsoft YaHei",sans-serif;font-variant-numeric:tabular-nums}
        #mwi-credit-optimizer [data-role="construction-view"] :is(button,input,select,summary){font-family:inherit;box-sizing:border-box}
        #mwi-credit-optimizer [data-role="construction-view"] :is(input,select){color-scheme:dark;background:var(--build-field);border:1px solid #626b86;color:var(--build-text);font-size:14px;border-radius:5px;caret-color:var(--build-accent)}
        #mwi-credit-optimizer [data-role="construction-view"] input::placeholder{color:var(--build-muted);opacity:1}
        #mwi-credit-optimizer [data-role="construction-view"] :is(button,summary,input,select):focus-visible{outline:2px solid var(--build-accent);outline-offset:2px}
        #mwi-credit-optimizer [data-role="construction-view"] button:disabled{opacity:.45;cursor:default}
        #mwi-credit-optimizer [data-role="construction-view"] ::selection{background:#34685e;color:#fff}
        #mwi-credit-optimizer [data-role="construction-view"] [hidden]{display:none!important}
        #mwi-credit-optimizer .mwi-construction-icon{display:block;width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
        #mwi-credit-optimizer .mwi-construction-status{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin:8px 0;padding:8px 10px;background:#293849;color:#d7e9f1;border-radius:5px;font-size:12px}
        #mwi-credit-optimizer .mwi-construction-status>span{min-width:0}
        #mwi-credit-optimizer .mwi-construction-status button{min-height:32px;padding:4px 8px}
        #mwi-credit-optimizer .mwi-guild-point-planning{padding:12px 0 16px;margin-bottom:12px;border-bottom:1px solid var(--build-line)}
        #mwi-credit-optimizer .mwi-construction-planning-heading{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:4px 12px;margin-bottom:12px}
        #mwi-credit-optimizer .mwi-construction-planning-heading h4{margin:0;color:var(--build-text);font-size:16px;font-weight:650}
        #mwi-credit-optimizer .mwi-construction-planning-heading>span{display:flex;align-items:baseline;gap:8px;color:var(--build-muted)}
        #mwi-credit-optimizer .mwi-construction-planning-heading small{font-size:12px}
        #mwi-credit-optimizer .mwi-construction-planning-heading strong{font-size:20px;color:var(--build-text)}
        #mwi-credit-optimizer .mwi-construction-planning-body{display:grid;gap:12px}
        #mwi-credit-optimizer .mwi-guild-point-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-content:start;gap:8px 12px;min-width:0}
        #mwi-credit-optimizer .mwi-guild-point-controls>label,#mwi-credit-optimizer .mwi-construction-budget-input{display:grid;align-content:start;gap:4px;min-width:0;color:var(--build-text);font-size:14px}
        #mwi-credit-optimizer .mwi-construction-budget-input label{display:grid;gap:4px;font-size:14px;font-weight:400}
        #mwi-credit-optimizer .mwi-construction-budget-input input{width:100%;min-width:0;height:36px;padding:4px 8px;font-variant-numeric:tabular-nums}
        #mwi-credit-optimizer .mwi-construction-budget-input>small,#mwi-credit-optimizer .mwi-guild-point-controls label small{color:var(--build-muted);font-size:12px;line-height:1.4;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-guild-point-week-stepper{width:100%;min-width:0;height:36px}
        #mwi-credit-optimizer .mwi-guild-point-week-stepper input{flex:1;width:0;min-width:0;height:36px;padding:4px 8px;text-align:left}
        #mwi-credit-optimizer .mwi-guild-point-planning-options{min-width:0;padding:8px 0;color:var(--build-muted);font-size:12px}
        #mwi-credit-optimizer .mwi-construction-planning-help{padding:8px 0 0;border-top:1px solid var(--build-line)}
        #mwi-credit-optimizer .mwi-construction-planning-help p{margin:0 0 4px;font-size:12px;color:var(--build-muted)}
        #mwi-credit-optimizer .mwi-guild-point-planning-options>label{display:grid;grid-template-columns:minmax(0,1fr) 96px;align-items:center;gap:6px;padding:8px 0}
        #mwi-credit-optimizer .mwi-guild-point-planning-options label small{grid-column:1/-1;color:var(--build-muted);font-size:12px;line-height:1.4;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-guild-point-controls output{grid-column:1/-1;grid-row:2;min-width:0;color:var(--build-accent);font-size:14px;line-height:1.5;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-guild-point-controls output[data-state="warning"]{color:var(--build-warning)}
        #mwi-credit-optimizer .mwi-construction-outcome{min-width:0}
        #mwi-credit-optimizer .mwi-construction-budget{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 12px;padding:12px;background:var(--build-surface);border-radius:6px}
        #mwi-credit-optimizer .mwi-construction-metric{display:grid;align-content:start;gap:4px;min-width:0}
        #mwi-credit-optimizer .mwi-construction-metric small{color:var(--build-muted);font-size:12px;line-height:1.4;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-construction-metric strong{font-size:20px;line-height:1.3;font-weight:650;overflow-wrap:anywhere;color:var(--build-text)}
        #mwi-credit-optimizer .mwi-construction-metric[data-state="danger"] strong{color:var(--build-danger)}
        #mwi-credit-optimizer .mwi-construction-budget-summary{grid-column:1/-1;min-width:0;color:var(--build-muted);font-size:14px;line-height:1.45;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-construction-budget-summary:empty{display:none}
        #mwi-credit-optimizer .mwi-construction-budget[data-over-budget="true"] .mwi-construction-budget-summary{color:var(--build-warning)}
        #mwi-credit-optimizer .mwi-guild-point-eta{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 8px;margin-top:8px}
        #mwi-credit-optimizer .mwi-guild-point-eta small{color:var(--build-muted);font-size:12px}
        #mwi-credit-optimizer .mwi-guild-point-eta strong{color:var(--build-warning);font-size:14px;font-weight:600}
        #mwi-credit-optimizer .mwi-guild-point-eta span{flex:1 1 180px;min-width:0;color:var(--build-muted);font-size:12px;line-height:1.45}
        #mwi-credit-optimizer .mwi-guild-point-eta[data-status="covered"] strong{color:var(--build-accent)}
        #mwi-credit-optimizer .mwi-construction-layout{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;align-items:start}
        #mwi-credit-optimizer .mwi-construction-queue-pane,#mwi-credit-optimizer .mwi-building-picker{min-width:0;container-type:inline-size}
        #mwi-credit-optimizer .mwi-construction-queue-heading{display:flex;align-items:start;justify-content:space-between;flex-wrap:wrap;gap:6px 12px;padding:0 0 10px;border-bottom:1px solid var(--build-line)}
        #mwi-credit-optimizer .mwi-construction-queue-heading>span:first-child{display:grid;gap:3px;min-width:0}
        #mwi-credit-optimizer .mwi-construction-queue-heading h4{margin:0;font-size:16px;font-weight:650;color:var(--build-text)}
        #mwi-credit-optimizer .mwi-construction-queue-heading small{color:var(--build-muted);font-size:12px;line-height:1.4}
        #mwi-credit-optimizer .mwi-construction-queue-meta{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;min-width:0}
        #mwi-credit-optimizer .mwi-construction-actions{display:flex;align-items:center;flex-wrap:wrap;gap:4px}
        #mwi-credit-optimizer .mwi-construction-actions button{min-height:30px;padding:4px 8px;background:#34394f;color:var(--build-text);font-size:12px}
        #mwi-credit-optimizer .mwi-construction-actions button:hover{background:#454e68}
        #mwi-credit-optimizer .mwi-construction-more{position:relative}
        #mwi-credit-optimizer .mwi-construction-more summary{display:grid;place-items:center;width:30px;height:30px;list-style:none;border-radius:4px;background:#34394f;color:var(--build-text);cursor:pointer}
        #mwi-credit-optimizer .mwi-construction-more summary::-webkit-details-marker{display:none}
        #mwi-credit-optimizer .mwi-construction-more>div{position:absolute;top:34px;right:0;z-index:12;width:max-content;max-width:240px;padding:4px;border-radius:6px;background:#303448;box-shadow:0 8px 20px #10111ccc}
        #mwi-credit-optimizer .mwi-construction-more .mwi-clear-building-plans{color:var(--build-danger)}
        #mwi-credit-optimizer .mwi-construction-empty{display:grid;gap:4px;padding:20px 0;color:var(--build-text)}
        #mwi-credit-optimizer .mwi-construction-empty strong{font-size:14px}
        #mwi-credit-optimizer .mwi-construction-empty small{font-size:12px;color:var(--build-muted)}
        #mwi-credit-optimizer .mwi-construction-rail{display:grid;gap:0;position:relative;margin:0;padding:0;list-style:none}
        #mwi-credit-optimizer .mwi-construction-group{position:relative;border-bottom:1px solid var(--build-line);background:transparent;transition:background .16s ease-out}
        #mwi-credit-optimizer .mwi-construction-group:hover{background:#25293e}
        #mwi-credit-optimizer .mwi-construction-row{display:grid;grid-template-columns:24px 32px minmax(0,1fr) auto;grid-template-rows:auto auto;align-items:center;gap:6px 8px;padding:10px 0}
        #mwi-credit-optimizer .mwi-construction-drag-handle{grid-column:1;grid-row:1/-1;align-self:stretch;display:grid;place-items:center;min-width:24px;width:24px;min-height:32px;padding:0!important;background:transparent!important;color:var(--build-muted)!important;touch-action:none;cursor:grab}
        #mwi-credit-optimizer .mwi-construction-drag-handle:active{cursor:grabbing}
        #mwi-credit-optimizer .mwi-construction-drag-handle span{width:3px;height:3px;border-radius:50%;background:currentColor;box-shadow:0 -5px currentColor,0 5px currentColor,5px -5px currentColor,5px 0 currentColor,5px 5px currentColor;transform:translateX(-2px)}
        #mwi-credit-optimizer .mwi-construction-building-icon{grid-column:2;grid-row:1;display:grid;place-items:center}
        #mwi-credit-optimizer .mwi-construction-identity{grid-column:3;grid-row:1;display:grid;gap:3px;min-width:0}
        #mwi-credit-optimizer .mwi-construction-identity strong{font-size:14px;font-weight:600;color:var(--build-text);overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-construction-identity small{font-size:12px;color:var(--build-muted);overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-construction-cost{grid-column:4;grid-row:1;display:grid;gap:2px;justify-items:end;min-width:0;text-align:right}
        #mwi-credit-optimizer .mwi-construction-cost small{font-size:12px;color:var(--build-muted)}
        #mwi-credit-optimizer .mwi-construction-cost strong{font-size:16px;font-weight:600;color:var(--build-text)}
        #mwi-credit-optimizer .mwi-construction-cost em{font-size:12px;font-style:normal;color:var(--build-muted);overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-construction-group[data-budget-state="within"] .mwi-construction-cost em{color:var(--build-accent)}
        #mwi-credit-optimizer .mwi-construction-group[data-budget-state="partial"] .mwi-construction-cost em{color:var(--build-warning)}
        #mwi-credit-optimizer .mwi-construction-group[data-budget-state="outside"] .mwi-construction-cost em{color:var(--build-danger)}
        #mwi-credit-optimizer .mwi-construction-row-actions{grid-column:2/-1;grid-row:2;display:flex;align-items:center;flex-wrap:wrap;gap:4px;min-width:0}
        #mwi-credit-optimizer .mwi-construction-target{display:flex;align-items:center;gap:6px;min-width:0;font-size:14px;color:var(--build-muted)}
        #mwi-credit-optimizer .mwi-construction-target select{width:72px;min-width:0;height:32px;padding:3px 6px}
        #mwi-credit-optimizer .mwi-construction-row-actions button{display:grid;place-items:center;min-height:32px;height:32px;padding:3px 6px;background:#34394f;color:var(--build-text);font-size:14px}
        #mwi-credit-optimizer .mwi-construction-row-actions button:hover{background:#454e68}
        #mwi-credit-optimizer .mwi-construction-level-button{min-width:30px}
        #mwi-credit-optimizer .mwi-construction-order-actions{display:flex;gap:4px;margin-left:auto}
        #mwi-credit-optimizer .mwi-construction-order-actions .mwi-icon-button:before{content:none}
        #mwi-credit-optimizer .mwi-construction-order-actions .mwi-icon-button{min-width:28px;width:28px;height:32px;min-height:32px}
        #mwi-credit-optimizer .mwi-construction-expand,#mwi-credit-optimizer .mwi-construction-remove{width:28px;min-width:28px;padding:0!important}
        #mwi-credit-optimizer .mwi-construction-row-actions .mwi-construction-remove{background:transparent;color:var(--build-muted)}
        #mwi-credit-optimizer .mwi-construction-row-actions .mwi-construction-remove:hover{background:#51333f;color:var(--build-danger)}
        #mwi-credit-optimizer .mwi-construction-expand[aria-expanded="true"] svg{transform:rotate(180deg)}
        #mwi-credit-optimizer .mwi-construction-group-steps{display:grid;margin-left:32px;border-top:1px solid var(--build-line)}
        #mwi-credit-optimizer .mwi-construction-step{display:grid;grid-template-columns:24px minmax(0,1fr) auto;align-items:center;gap:8px;min-height:34px;padding:4px 8px;border-bottom:1px solid #353b53}
        #mwi-credit-optimizer .mwi-construction-step-index{font-size:12px;color:var(--build-muted)}
        #mwi-credit-optimizer .mwi-construction-step-copy{min-width:0}
        #mwi-credit-optimizer .mwi-construction-step-copy small{font-size:12px;color:var(--build-muted)}
        #mwi-credit-optimizer .mwi-construction-step-cost{font-size:14px;color:var(--build-text)}
        #mwi-credit-optimizer .mwi-construction-step[data-over-budget="true"] .mwi-construction-step-cost{color:var(--build-danger)}
        #mwi-credit-optimizer .mwi-budget-cutoff{margin:0 0 8px 32px;padding:4px 8px;border-radius:4px;background:#382f36;color:var(--build-warning);font-size:12px;line-height:1.4}
        #mwi-credit-optimizer .mwi-sort-dragging.mwi-construction-group{background:#303b49;box-shadow:0 8px 20px #090a1280;opacity:.95}
        #mwi-credit-optimizer .mwi-building-picker{background:var(--build-surface);border-radius:6px}
        #mwi-credit-optimizer .mwi-building-picker-toggle{display:grid;grid-template-columns:20px minmax(0,1fr) 16px;align-items:center;gap:8px;width:100%;min-height:42px;padding:8px 10px!important;border-radius:6px;background:transparent;color:var(--build-text);text-align:left}
        #mwi-credit-optimizer .mwi-building-picker-toggle:hover{background:#30374c}
        #mwi-credit-optimizer .mwi-building-picker-plus{color:var(--build-accent)}
        #mwi-credit-optimizer .mwi-building-picker-toggle>span:nth-child(2){display:flex;align-items:baseline;flex-wrap:wrap;gap:3px 8px;min-width:0}
        #mwi-credit-optimizer .mwi-building-picker-toggle strong{font-size:14px;font-weight:600;color:var(--build-accent)}
        #mwi-credit-optimizer .mwi-building-level-status{font-size:12px;color:var(--build-warning)}
        #mwi-credit-optimizer .mwi-building-level-status[data-complete="true"]{color:var(--build-muted)}
        #mwi-credit-optimizer .mwi-building-picker-chevron{color:var(--build-muted)}
        #mwi-credit-optimizer .mwi-building-picker[data-open="true"] .mwi-building-picker-chevron{transform:rotate(180deg)}
        #mwi-credit-optimizer .mwi-building-picker-body{min-width:0;border-top:1px solid var(--build-line)}
        #mwi-credit-optimizer .mwi-building-pane-heading{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:10px}
        #mwi-credit-optimizer .mwi-building-pane-heading>span{flex:1 1 140px;min-width:0}
        #mwi-credit-optimizer .mwi-building-pane-heading h4{margin:0 0 3px;font-size:14px;color:var(--build-text)}
        #mwi-credit-optimizer .mwi-building-pane-heading small{font-size:12px;color:var(--build-muted);line-height:1.4}
        #mwi-credit-optimizer .mwi-building-pane-heading input{flex:1 1 120px;min-width:0;width:100%;height:34px;padding:4px 8px}
        #mwi-credit-optimizer .mwi-building-categories{display:flex;flex-wrap:wrap;gap:4px;padding:0 10px 8px;border-bottom:1px solid var(--build-line)}
        #mwi-credit-optimizer .mwi-building-categories button{min-height:32px;padding:4px 8px;background:transparent;color:var(--build-muted);font-size:14px;border-radius:4px}
        #mwi-credit-optimizer .mwi-building-categories button:hover{background:#343b52;color:var(--build-text)}
        #mwi-credit-optimizer .mwi-building-categories button[data-active="true"]{background:#34514e;color:#d5f7ed}
        #mwi-credit-optimizer .mwi-building-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,156px),1fr));gap:2px;padding:6px;max-height:340px;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#66708b var(--build-surface)}
        #mwi-credit-optimizer .mwi-building-tile{display:grid;grid-template-columns:30px minmax(0,1fr);align-items:center;gap:8px;min-width:0;min-height:56px;padding:6px!important;border:1px solid transparent;border-radius:4px;background:transparent;color:var(--build-text);text-align:left}
        #mwi-credit-optimizer .mwi-building-tile:hover{border-color:#626b86;background:#313a50}
        #mwi-credit-optimizer .mwi-building-tile[data-planned="true"]{background:#293f41;border-color:#527b73}
        #mwi-credit-optimizer .mwi-building-icon{display:block;width:30px;height:30px;flex:0 0 30px}
        #mwi-credit-optimizer .mwi-building-icon svg{display:block;width:100%;height:100%}
        #mwi-credit-optimizer .mwi-building-icon-fallback svg{padding:3px;fill:none;stroke:var(--build-muted);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
        #mwi-credit-optimizer .mwi-building-tile-copy{display:grid;gap:2px;min-width:0}
        #mwi-credit-optimizer .mwi-building-tile-name{font-size:14px;font-weight:500;line-height:1.4;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-building-tile-level,#mwi-credit-optimizer .mwi-building-tile-cost{font-size:12px;font-weight:400;line-height:1.4;color:var(--build-muted);overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-building-tile[data-planned="true"] .mwi-building-tile-level{color:var(--build-accent)}
        #mwi-credit-optimizer .mwi-guild-point-forecast{min-width:0;margin-top:20px;padding-top:14px;border-top:1px solid var(--build-line)}
        #mwi-credit-optimizer .mwi-guild-point-forecast-heading{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:4px 12px}
        #mwi-credit-optimizer .mwi-guild-point-forecast-heading>span:first-child{display:grid;gap:3px;min-width:0}
        #mwi-credit-optimizer .mwi-guild-point-forecast-heading h4{margin:0;font-size:16px;font-weight:650;color:var(--build-text)}
        #mwi-credit-optimizer .mwi-guild-point-forecast-heading small{font-size:12px;color:var(--build-muted);line-height:1.4}
        #mwi-credit-optimizer .mwi-guild-point-autosaved{font-size:12px;color:var(--build-accent)}
        #mwi-credit-optimizer .mwi-guild-point-autosaved[data-source="cache"]{color:var(--build-warning)}
        #mwi-credit-optimizer .mwi-guild-point-forecast-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:12px 0}
        #mwi-credit-optimizer .mwi-guild-point-forecast-grid>div{display:grid;align-content:start;gap:4px;min-width:0}
        #mwi-credit-optimizer .mwi-guild-point-forecast-grid small{color:var(--build-muted);font-size:12px;line-height:1.4}
        #mwi-credit-optimizer .mwi-guild-point-forecast-grid strong{font-size:20px;line-height:1.3;font-weight:600;color:var(--build-text);overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-guild-point-forecast-grid [data-trend="up"] strong{color:var(--build-accent)}
        #mwi-credit-optimizer .mwi-guild-point-forecast-grid [data-trend="down"] strong{color:var(--build-danger)}
        #mwi-credit-optimizer .mwi-guild-point-forecast-footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px 12px;padding:0 0 10px}
        #mwi-credit-optimizer .mwi-guild-point-forecast-status{flex:1 1 220px;min-width:0;margin:0;color:var(--build-muted);font-size:12px;line-height:1.5}
        #mwi-credit-optimizer .mwi-guild-point-history-actions{display:flex;flex:0 1 auto;flex-wrap:wrap;gap:6px;min-width:0;max-width:100%}
        #mwi-credit-optimizer .mwi-guild-point-history-actions button{min-height:30px;padding:4px 8px;background:#34394f;color:var(--build-text);font-size:12px}
        #mwi-credit-optimizer .mwi-guild-point-history{min-width:0;margin-top:8px;border:0;border-radius:0;background:transparent;font-size:14px;line-height:1.45}
        #mwi-credit-optimizer .mwi-guild-point-history>summary{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;width:100%;padding:12px 14px;border:1px solid var(--build-line);border-radius:5px;background:#34394f;color:var(--build-text);font-size:14px;font-weight:600;text-align:left;list-style:none;cursor:pointer}
        #mwi-credit-optimizer .mwi-guild-point-history>summary::-webkit-details-marker{display:none}
        #mwi-credit-optimizer .mwi-guild-point-history>summary:hover{background:#454e68}
        #mwi-credit-optimizer .mwi-guild-point-history>summary:focus-visible{outline:2px solid var(--build-accent);outline-offset:2px}
        #mwi-credit-optimizer .mwi-guild-point-history>summary .mwi-construction-icon{flex:0 0 16px}
        #mwi-credit-optimizer .mwi-guild-point-history[open]>summary .mwi-construction-icon{transform:rotate(180deg)}
        #mwi-credit-optimizer .mwi-guild-point-table-scroll{scrollbar-width:thin;scrollbar-color:#66708b var(--build-surface)}
        #mwi-credit-optimizer .mwi-guild-point-history :is(th,td){padding:8px 10px;border-bottom-color:var(--build-line)}
        #mwi-credit-optimizer .mwi-guild-point-history thead th{background:#30364b;color:#cbd4e9}
        #mwi-credit-optimizer .mwi-guild-point-history tbody :is(th,td){background:transparent}
        #mwi-credit-optimizer .mwi-guild-point-history tbody tr:hover :is(th,td){background:#30394d}
        #mwi-credit-optimizer .mwi-guild-point-history td small{font-size:12px;color:var(--build-muted)}
        #mwi-credit-optimizer .mwi-guild-point-history td:last-child{white-space:normal;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-guild-point-tracked-value{flex-wrap:wrap}
        #mwi-credit-optimizer .mwi-guild-point-manual-footer{flex-wrap:wrap;padding:10px 0}
        #mwi-credit-optimizer .mwi-guild-point-manual-hint{font-size:12px;color:var(--build-muted)}
        @container (min-width:720px){
          #mwi-credit-optimizer .mwi-construction-planning-body{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px}
          #mwi-credit-optimizer .mwi-construction-layout[data-picker-open="true"]{grid-template-columns:minmax(0,1.25fr) minmax(0,1fr)}
        }
        @container (max-width:370px){
          #mwi-credit-optimizer .mwi-construction-row{grid-template-columns:20px 28px minmax(0,1fr);gap:6px;padding-block:10px}
          #mwi-credit-optimizer .mwi-construction-drag-handle{grid-row:1/4;min-width:20px;width:20px}
          #mwi-credit-optimizer .mwi-construction-cost{grid-column:2/-1;grid-row:2;display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 8px;text-align:left}
          #mwi-credit-optimizer .mwi-construction-row-actions{grid-row:3}
          #mwi-credit-optimizer .mwi-construction-order-actions{margin-left:0}
          #mwi-credit-optimizer .mwi-construction-target select{width:66px}
          #mwi-credit-optimizer .mwi-construction-metric strong,#mwi-credit-optimizer .mwi-guild-point-forecast-grid strong{font-size:18px}
        }
        @media (prefers-reduced-motion:reduce){#mwi-credit-optimizer .mwi-construction-group{transition:none}}

        /* Shrine plan editor: effects and costs stay next to the chosen interval. */
        #mwi-credit-optimizer .mwi-upgrade-planner{background:#24273b;border:1px solid #41465f;border-radius:6px;box-shadow:none;text-align:left}
        #mwi-credit-optimizer .mwi-upgrade-planner .mwi-upgrade-plan-list{gap:0}
        #mwi-credit-optimizer .mwi-upgrade-planner .mwi-upgrade-plan{display:block;min-width:0;padding:12px;border:0;border-top:1px solid #41465f;border-radius:0;background:transparent;box-shadow:none;font:14px/1.45 system-ui,-apple-system,"Microsoft YaHei",sans-serif;font-variant-numeric:tabular-nums;color:#edf0fa}
        #mwi-credit-optimizer .mwi-upgrade-planner .mwi-upgrade-plan:hover,#mwi-credit-optimizer .mwi-upgrade-planner .mwi-upgrade-plan:focus-within{background:transparent}
        #mwi-credit-optimizer .mwi-shrine-plan-header{display:grid;grid-template-columns:32px minmax(0,1fr) 32px;gap:8px;align-items:end}
        #mwi-credit-optimizer .mwi-shrine-plan-header .mwi-building-icon{display:block;width:32px;height:32px}
        #mwi-credit-optimizer .mwi-shrine-plan-header .mwi-shrine-plan-icon{align-self:center}
        #mwi-credit-optimizer .mwi-upgrade-planner .mwi-upgrade-plan :is(.mwi-upgrade-plan-shrine,.mwi-upgrade-plan-start,.mwi-upgrade-plan-target){display:grid;gap:4px;min-width:0;grid-column:auto;grid-row:auto;text-align:left;justify-items:stretch;font-weight:400}
        #mwi-credit-optimizer .mwi-upgrade-planner .mwi-upgrade-field-label{display:block;color:#b7bfd4;font-size:12px}
        #mwi-credit-optimizer .mwi-upgrade-planner .mwi-upgrade-plan select{width:100%!important;min-height:36px;padding:5px 8px;border:1px solid #626b86;border-radius:5px;background:#191c2e;color:#edf0fa;font:14px/1.4 system-ui,sans-serif}
        #mwi-credit-optimizer .mwi-upgrade-planner .mwi-remove-plan{grid-column:auto;grid-row:auto;display:grid;place-items:center;align-self:end;min-width:32px;width:32px;height:36px;min-height:36px;padding:4px!important;border:0;background:transparent!important;color:#b7bfd4!important;box-shadow:none}
        #mwi-credit-optimizer .mwi-upgrade-planner .mwi-remove-plan:hover{background:#503445!important;color:#ffa7b5!important}
        #mwi-credit-optimizer .mwi-shrine-level-status{margin:8px 0 12px;color:#b7bfd4;font-size:12px;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-shrine-level-controls{display:grid;grid-template-columns:minmax(0,1fr) 16px minmax(0,1fr) auto;gap:8px;align-items:end}
        #mwi-credit-optimizer .mwi-shrine-level-controls .mwi-upgrade-level-arrow{grid-column:auto;grid-row:auto;display:block;align-self:end;line-height:36px;color:#b7bfd4;font-size:14px}
        #mwi-credit-optimizer .mwi-shrine-target-actions{display:flex;flex-wrap:wrap;gap:6px}
        #mwi-credit-optimizer .mwi-shrine-target-actions button{min-height:36px;padding:5px 8px;font-size:12px;border:1px solid #41465f;border-radius:4px;background:#34394f;color:#edf0fa}
        #mwi-credit-optimizer .mwi-shrine-target-actions button:hover{background:#454e68}
        #mwi-credit-optimizer .mwi-shrine-target-actions button:disabled{opacity:.45;cursor:default}
        #mwi-credit-optimizer .mwi-shrine-warning{margin:8px 0;color:#e9c487;font-size:12px;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-shrine-plan-effects,#mwi-credit-optimizer .mwi-shrine-plan-cost{margin-top:12px}
        #mwi-credit-optimizer .mwi-upgrade-plan h4{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;margin:0 0 6px;color:#b7bfd4;font-size:12px;font-weight:600;text-align:left}
        #mwi-credit-optimizer .mwi-upgrade-plan h4 small{color:#b7bfd4;font-size:12px;font-weight:400}
        #mwi-credit-optimizer .mwi-shrine-effect-comparison{margin:0}
        #mwi-credit-optimizer .mwi-shrine-effect-comparison>div{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:4px 12px;padding:4px 0}
        #mwi-credit-optimizer .mwi-shrine-effect-comparison dt{color:#edf0fa}
        #mwi-credit-optimizer .mwi-shrine-effect-comparison dd{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0;color:#b7bfd4}
        #mwi-credit-optimizer .mwi-shrine-effect-comparison dd strong{color:#91dfcb;font-weight:600}
        #mwi-credit-optimizer .mwi-shrine-effect-comparison dd small{color:#91dfcb;font-size:12px}
        #mwi-credit-optimizer .mwi-shrine-materials{display:flex;flex-wrap:wrap;gap:6px 16px;list-style:none;margin:0;padding:0}
        #mwi-credit-optimizer .mwi-shrine-materials li{display:inline-flex;align-items:center;flex-wrap:wrap;gap:4px;min-width:0;color:#edf0fa;font-size:12px;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-shrine-materials .mwi-item-icon{width:20px;height:20px;flex:0 0 20px}
        #mwi-credit-optimizer .mwi-shrine-materials strong{font-size:14px;font-weight:600}
        #mwi-credit-optimizer .mwi-shrine-steps{margin-top:12px;border-top:1px solid #41465f;font-size:12px;color:#b7bfd4}
        #mwi-credit-optimizer .mwi-shrine-steps summary{padding:8px 0;cursor:pointer;color:#91dfcb;min-height:32px;width:fit-content}
        #mwi-credit-optimizer .mwi-shrine-steps summary:focus-visible{outline:2px solid #91dfcb;outline-offset:2px}
        #mwi-credit-optimizer .mwi-shrine-muted{margin:0 0 6px;color:#b7bfd4;font-size:12px;line-height:1.5}
        #mwi-credit-optimizer .mwi-shrine-steps ol{list-style:none;padding:0;margin:0}
        #mwi-credit-optimizer .mwi-shrine-steps ol>li{padding:10px 0;border-bottom:1px solid #41465f}
        #mwi-credit-optimizer .mwi-shrine-steps ol>li:last-child{border-bottom:0;padding-bottom:0}
        #mwi-credit-optimizer .mwi-shrine-step-heading{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 16px;margin-bottom:6px}
        #mwi-credit-optimizer .mwi-shrine-step-heading strong{color:#edf0fa;font-weight:600}
        #mwi-credit-optimizer .mwi-shrine-step-heading span{color:#91dfcb}
        @container (max-width:520px){#mwi-credit-optimizer .mwi-shrine-level-controls{grid-template-columns:minmax(0,1fr) 16px minmax(0,1fr)}#mwi-credit-optimizer .mwi-shrine-target-actions{grid-column:1/-1}}

        #mwi-credit-optimizer .mwi-shrine-collapse-bar{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:6px;color:#b7bfd4;font-size:12px}
        #mwi-credit-optimizer .mwi-shrine-collapse-bar button{display:inline-flex;align-items:center;gap:4px;min-height:30px;padding:4px 6px;border:0;border-radius:4px;background:transparent;color:#91dfcb;font:inherit;cursor:pointer}
        #mwi-credit-optimizer .mwi-shrine-collapse-bar button:hover{background:#34394f}
        #mwi-credit-optimizer .mwi-shrine-collapse-bar button:focus-visible{outline:2px solid #91dfcb;outline-offset:2px}
        #mwi-credit-optimizer .mwi-shrine-collapse-bar button[aria-expanded="true"] svg{transform:rotate(180deg)}
        #mwi-credit-optimizer .mwi-shrine-plan-body[hidden]{display:none!important}

        /* Custom shrine choices stay in the top layer, outside sidebar clipping. */
        #mwi-credit-optimizer .mwi-upgrade-plan select[hidden]{display:none!important}
        #mwi-credit-optimizer .mwi-upgrade-plan .mwi-shrine-picker-trigger{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-width:0;min-height:36px;padding:6px 10px;border:1px solid #626b86;border-radius:5px;background:#191c2e;color:#edf0fa;font:14px/1.4 system-ui,-apple-system,"Microsoft YaHei",sans-serif;text-align:left;cursor:pointer}
        #mwi-credit-optimizer .mwi-shrine-picker-trigger>span{min-width:0;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-shrine-picker-trigger>svg{flex:0 0 16px;color:#b7bfd4;transition:transform .16s ease-out}
        #mwi-credit-optimizer .mwi-upgrade-plan .mwi-shrine-picker-trigger:hover{background:#24273b;border-color:#91dfcb}
        #mwi-credit-optimizer .mwi-upgrade-plan .mwi-shrine-picker-trigger[aria-expanded="true"]{border-color:#91dfcb}
        #mwi-credit-optimizer .mwi-shrine-picker-trigger[aria-expanded="true"]>svg{transform:rotate(180deg)}
        #mwi-credit-optimizer .mwi-shrine-picker-trigger:focus-visible{outline:2px solid #91dfcb;outline-offset:2px}
        .mwi-shrine-picker-popover{position:fixed;inset:auto;margin:0;padding:6px;box-sizing:border-box;overflow:auto;overscroll-behavior:contain;border:0;border-radius:6px;background:#24273b;color:#edf0fa;box-shadow:0 8px 20px #10111ccc;font:14px/1.45 system-ui,-apple-system,"Microsoft YaHei",sans-serif;font-variant-numeric:tabular-nums;scrollbar-width:thin;scrollbar-color:#66708b #24273b;z-index:2147483647;text-align:left;color-scheme:dark}
        .mwi-shrine-picker-popover[data-fallback]{display:block}
        .mwi-shrine-picker-popover:focus{outline:2px solid #91dfcb;outline-offset:1px}
        .mwi-shrine-picker-popover::selection{background:#34685e;color:#fff}
        .mwi-shrine-picker-popover .mwi-shrine-picker-group{padding:8px 8px 6px;font-size:12px;color:#b7bfd4;font-weight:600}
        .mwi-shrine-picker-popover [role="group"]+[role="group"]{margin-top:6px;padding-top:4px;border-top:1px solid #41465f}
        .mwi-shrine-picker-popover .mwi-shrine-picker-option{display:flex;align-items:center;gap:10px;padding:9px 8px;min-height:36px;box-sizing:border-box;border-radius:4px;cursor:pointer;scroll-margin:6px}
        .mwi-shrine-picker-popover .mwi-shrine-picker-option[aria-selected="true"]{background:#34514e;color:#d5f7ed}
        .mwi-shrine-picker-popover .mwi-shrine-picker-option[data-active]{outline:1px solid #91dfcb;outline-offset:-1px;background:#34394f}
        .mwi-shrine-picker-popover .mwi-shrine-picker-option[aria-selected="true"][data-active]{background:#34514e}
        .mwi-shrine-picker-popover .mwi-shrine-picker-option[aria-disabled="true"]{opacity:.5;cursor:not-allowed}
        .mwi-shrine-picker-popover .mwi-shrine-picker-copy{flex:1;min-width:0;overflow-wrap:anywhere}
        .mwi-shrine-picker-popover .mwi-shrine-picker-copy>span{display:block;font-weight:600}
        .mwi-shrine-picker-popover .mwi-shrine-picker-copy>small{display:block;margin-top:3px;color:#b7bfd4;font-size:12px;font-weight:400}
        .mwi-shrine-picker-popover [aria-selected="true"] .mwi-shrine-picker-copy>small{color:#d5f7ed}
        .mwi-shrine-picker-popover .mwi-shrine-picker-icon{display:flex;flex:0 0 28px;align-items:center;justify-content:center}
        .mwi-shrine-picker-popover .mwi-shrine-picker-icon :is(svg,img){width:28px;height:28px}
        .mwi-shrine-picker-popover .mwi-shrine-picker-check{display:flex;flex:0 0 16px;align-items:center;color:#91dfcb}
        @media(prefers-reduced-motion:reduce){#mwi-credit-optimizer .mwi-shrine-picker-trigger>svg{transition:none}}

          /* Trial workspace inherits the construction page's compact visual system. */
        #mwi-credit-optimizer [data-role="trials-view"]{--trial-surface:#24273b;--trial-field:#191c2e;--trial-line:#41465f;--trial-text:#edf0fa;--trial-muted:#b7bfd4;--trial-accent:#91dfcb;--trial-warning:#e9c487;--trial-danger:#ffa7b5;container-type:inline-size;container-name:mwi-trials;color:var(--trial-text);font:14px/1.45 system-ui,-apple-system,"Microsoft YaHei",sans-serif;font-variant-numeric:tabular-nums;scrollbar-color:#66708b var(--trial-surface)}
        #mwi-credit-optimizer [data-role="trials-view"] :is(input,select){width:100%;min-width:0;max-width:100%;padding:4px 8px;border:1px solid #626b86;border-radius:5px;background:var(--trial-field);color:var(--trial-text);color-scheme:dark;font:14px system-ui,sans-serif;caret-color:var(--trial-accent)}
        #mwi-credit-optimizer [data-role="trials-view"] input::placeholder{color:var(--trial-muted);opacity:1}
        #mwi-credit-optimizer [data-role="trials-view"] button{min-height:30px;padding:4px 8px;border-radius:4px;background:#34394f;color:var(--trial-text);font-size:12px}
        #mwi-credit-optimizer [data-role="trials-view"] button:hover{background:#454e68}
        #mwi-credit-optimizer [data-role="trials-view"] button:disabled{opacity:.45;cursor:default}
        #mwi-credit-optimizer [data-role="trials-view"] :is(button,input,select,summary,[tabindex]):focus-visible{outline:2px solid var(--trial-accent);outline-offset:2px}
        #mwi-credit-optimizer [data-role="trials-view"] ::selection{background:#34685e;color:#fff}
        #mwi-credit-optimizer .mwi-trial-toolbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 16px}
        #mwi-credit-optimizer .mwi-trial-heading{flex:1 1 180px;min-width:0}
        #mwi-credit-optimizer .mwi-trial-heading h2{margin:0;font-size:16px;font-weight:650}
        #mwi-credit-optimizer .mwi-trial-toolbar .mwi-trial-controls{margin:0}
        #mwi-credit-optimizer .mwi-trial-heading .mwi-trial-notice{margin:4px 0 0}
        #mwi-credit-optimizer .mwi-trial-notice[data-state="saved"]{color:var(--trial-muted)}
        #mwi-credit-optimizer button[data-role="trial-import-open"],#mwi-credit-optimizer button[data-role="trial-import-confirm"]{background:#34514e;color:#d5f7ed}
        #mwi-credit-optimizer button[data-role="trial-import-open"]:hover,#mwi-credit-optimizer button[data-role="trial-import-confirm"]:hover{background:#41675f}
        #mwi-credit-optimizer .mwi-trial-guide{margin-top:6px;color:var(--trial-muted);font-size:12px}
        #mwi-credit-optimizer .mwi-trial-guide summary{width:fit-content;padding:5px 0;cursor:pointer}
        #mwi-credit-optimizer .mwi-trial-guide p{max-width:75ch}
        #mwi-credit-optimizer .mwi-trial-purpose{margin:12px 0;color:var(--trial-muted);font-size:12px;line-height:1.6;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-trial-purpose p{margin:6px 0}
        #mwi-credit-optimizer .mwi-trial-import-preview{padding:2px 12px 10px;margin-top:10px;border-radius:6px;background:var(--trial-surface)}
        #mwi-credit-optimizer .mwi-trial-import-list strong{grid-column:1/-1;font-weight:500;font-size:14px}
        #mwi-credit-optimizer .mwi-trial-table thead th{background:#30364b;color:#cbd4e9;font-size:12px;font-weight:500;position:sticky;top:0;z-index:1}
        #mwi-credit-optimizer [data-role="trials-view"] .mwi-trial-sort{display:inline-flex;align-items:center;justify-content:flex-end;gap:4px;min-height:24px;padding:0;border:0;border-radius:0;background:transparent;color:inherit;font:inherit;white-space:nowrap;cursor:pointer}
        #mwi-credit-optimizer [data-role="trials-view"] .mwi-trial-sort:hover{background:transparent;color:var(--trial-accent)}
        #mwi-credit-optimizer .mwi-trial-sort svg{flex:0 0 12px}
        #mwi-credit-optimizer .mwi-trial-table th:is([aria-sort="ascending"],[aria-sort="descending"]){color:var(--trial-accent)}
        #mwi-credit-optimizer .mwi-trial-table tbody tr:hover{background:#2d3349}
        #mwi-credit-optimizer .mwi-trial-table tbody tr:is(.mwi-trial-member-highlight,.mwi-trial-player-selected){background:#34514e;color:#d5f7ed}
        #mwi-credit-optimizer [data-role="trials-view"] .mwi-trial-profile-link{min-height:0;max-width:100%;padding:0;border:0;border-radius:0;background:transparent;color:inherit;font:inherit;text-align:inherit;white-space:normal;overflow-wrap:anywhere;cursor:pointer}
        #mwi-credit-optimizer [data-role="trials-view"] .mwi-trial-profile-link:hover{background:transparent;color:inherit;text-decoration:underline;text-underline-offset:3px}

        #mwi-credit-optimizer [data-role="trials-view"] .mwi-trial-heading-link[data-trial-ranking-player]{color:var(--trial-text)}
        #mwi-credit-optimizer .mwi-trial-member-name{display:inline-flex;align-items:center;gap:2px;max-width:100%;vertical-align:middle;color:var(--trial-text);font:inherit;white-space:normal}
        #mwi-credit-optimizer [data-mwi-trial-low-work="true"] .mwi-trial-member-name{color:inherit}
        #mwi-credit-optimizer .mwi-trial-name-text{min-width:0;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-trial-name-icon{width:1.125em;height:1.125em;flex:0 0 1.125em}
        #mwi-credit-optimizer [data-trial-simple-names][aria-pressed="true"]{background:#34514e;color:#d5f7ed;border-color:var(--trial-accent)}

        #mwi-credit-optimizer .mwi-trial-import{margin:0 0 8px;padding:0 0 6px;border-bottom:1px solid var(--trial-line);min-width:0}
        #mwi-credit-optimizer .mwi-trial-import [data-role="trial-import-status"]{color:var(--trial-warning);font-size:12px;line-height:1.5;overflow-wrap:anywhere;margin:8px 0 0}
        #mwi-credit-optimizer .mwi-trial-import [data-role="trial-import-status"]:empty{display:none}
        #mwi-credit-optimizer .mwi-trial-import-preview h3{margin:12px 0 6px;font-size:14px}
        #mwi-credit-optimizer .mwi-trial-import-list{list-style:none;padding:0;margin:8px 0;max-height:320px;overflow-y:auto;scrollbar-width:thin}
        #mwi-credit-optimizer .mwi-trial-import-list li{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3px 12px;padding:8px 0;border-bottom:1px solid var(--trial-line);overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-trial-import-list span{color:var(--trial-muted);font-size:12px;line-height:1.4}
        #mwi-credit-optimizer .mwi-trial-help,#mwi-credit-optimizer .mwi-trial-meta{margin:2px 0;color:var(--trial-muted);font-size:12px;line-height:1.5;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-trial-notice{margin:6px 0;color:var(--trial-warning);font-size:12px;line-height:1.5;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-trial-controls{display:flex;flex-wrap:wrap;align-items:end;gap:6px 8px;margin:8px 0}
        #mwi-credit-optimizer .mwi-trial-controls label{display:grid;gap:4px;flex:1 1 240px;min-width:0;font-size:12px;color:var(--trial-muted)}
        #mwi-credit-optimizer .mwi-trial-controls select{width:100%;min-width:0;max-width:100%;height:34px}
        #mwi-credit-optimizer .mwi-trial-table-scroll{position:relative;max-width:100%;overflow:visible}
        #mwi-credit-optimizer .mwi-trial-table{width:max-content;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:14px;line-height:1.35}
        #mwi-credit-optimizer .mwi-trial-table caption{text-align:left;padding:8px 0;color:var(--trial-muted);font-size:12px}
        #mwi-credit-optimizer .mwi-trial-table th,#mwi-credit-optimizer .mwi-trial-table td{padding:3px 4px;text-align:right;border-bottom:1px solid var(--trial-line);white-space:nowrap}
        #mwi-credit-optimizer .mwi-trial-table th:has([data-trial-sort="member"]),#mwi-credit-optimizer .mwi-trial-table th[scope="row"]{text-align:left;white-space:nowrap;min-width:0}
        #mwi-credit-optimizer [data-mwi-trial-low-work="true"], [class*="GuildPanel_signupModal__"] [data-mwi-trial-low-work="true"]{color:#ffa7b5!important;text-decoration:underline dotted;text-underline-offset:3px}
        :is(#mwi-credit-optimizer,[class*="GuildPanel_signupModal__"]) [data-mwi-trial-low-work="true"] :is(.mwi-trial-name-text,[class*="CharacterName_name__"],.mwi-trial-name-text span,[class*="CharacterName_name__"] span){color:#ffa7b5!important;-webkit-text-fill-color:#ffa7b5!important;background-image:none!important;text-shadow:none!important;animation:none!important}
        :is(#mwi-credit-optimizer,[class*="GuildPanel_signupModal__"]) [data-mwi-trial-low-work="true"] :is(.mwi-trial-name-text,[class*="CharacterName_name__"])::before,:is(#mwi-credit-optimizer,[class*="GuildPanel_signupModal__"]) [data-mwi-trial-low-work="true"] :is(.mwi-trial-name-text,[class*="CharacterName_name__"])::after{display:none!important}
        #mwi-credit-optimizer .mwi-trial-member-absent{display:inline-flex;vertical-align:middle;color:var(--trial-warning);cursor:help;line-height:1}
        #mwi-credit-optimizer .mwi-trial-member-absent:focus-visible{outline:2px solid var(--trial-accent);outline-offset:2px}
        #mwi-credit-optimizer .mwi-trial-table small{display:block;color:var(--trial-muted);font-size:12px;font-weight:normal}
        #mwi-credit-optimizer .mwi-trial-raw{margin:6px 0;min-width:0}
        #mwi-credit-optimizer .mwi-trial-raw summary{cursor:pointer;padding:4px 0;color:var(--trial-muted);font-size:12px}
        #mwi-credit-optimizer .mwi-trial-raw pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.5;max-height:360px;overflow:auto}
        #mwi-credit-optimizer .mwi-trial-display-settings{margin:8px 0 12px;border:1px solid var(--trial-line);border-radius:6px;background:var(--trial-surface);font-size:12px;color:var(--trial-muted);text-align:left}
        #mwi-credit-optimizer .mwi-trial-display-settings>summary{display:flex;align-items:center;gap:12px;min-height:40px;padding:8px 12px;cursor:pointer;list-style:none;color:var(--trial-text);font-size:14px;font-weight:600}
        #mwi-credit-optimizer .mwi-trial-display-settings>summary::-webkit-details-marker{display:none}
        #mwi-credit-optimizer .mwi-trial-display-settings>summary small{margin-left:auto;color:var(--trial-muted);font-size:12px;font-weight:400}
        #mwi-credit-optimizer .mwi-trial-display-settings>summary svg{flex-shrink:0;transition:transform .16s ease-out}
        #mwi-credit-optimizer .mwi-trial-display-settings[open]>summary svg{transform:rotate(180deg)}
        #mwi-credit-optimizer .mwi-trial-display-settings>summary:hover{background:#30364b}
        #mwi-credit-optimizer .mwi-trial-display-body{padding:0 12px 12px;border-top:1px solid var(--trial-line)}
        #mwi-credit-optimizer .mwi-trial-display-toolbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 16px;padding:10px 0}
        #mwi-credit-optimizer .mwi-trial-display-settings p{margin:0;line-height:1.5;max-width:75ch}
        #mwi-credit-optimizer .mwi-trial-display-presets{display:flex;flex-wrap:wrap;gap:6px}
        #mwi-credit-optimizer .mwi-trial-display-groups{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:16px 24px}
        #mwi-credit-optimizer .mwi-trial-display-settings fieldset{margin:0;padding:0;border:0;min-width:0}
        #mwi-credit-optimizer .mwi-trial-display-settings legend{display:flex;align-items:center;gap:8px;width:100%;padding:0 0 6px;border-bottom:1px solid var(--trial-line);font-size:12px;font-weight:600;color:var(--trial-muted)}
        #mwi-credit-optimizer .mwi-trial-display-settings legend span{margin-left:auto;font-weight:400;font-variant-numeric:tabular-nums}
        #mwi-credit-optimizer .mwi-trial-display-options{display:grid;padding-top:4px}
        #mwi-credit-optimizer .mwi-trial-display-options label{position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:36px;padding:4px 6px;cursor:pointer;color:var(--trial-text);font-size:14px;border-radius:4px}
        #mwi-credit-optimizer .mwi-trial-display-options label:hover{background:#30364b}
        #mwi-credit-optimizer [data-role="trials-view"] .mwi-trial-display-options input{position:absolute;opacity:0;width:1px;height:1px;padding:0;margin:0}
        #mwi-credit-optimizer .mwi-trial-display-options label:has(input:focus-visible){outline:2px solid var(--trial-accent);outline-offset:2px}
        #mwi-credit-optimizer .mwi-trial-switch{position:relative;flex:0 0 30px;height:18px;border:1px solid #77819b;border-radius:10px;background:var(--trial-field)}
        #mwi-credit-optimizer .mwi-trial-switch:after{content:"";position:absolute;top:3px;left:3px;width:10px;height:10px;border-radius:50%;background:#b7bfd4;transition:transform .16s ease-out}
        #mwi-credit-optimizer .mwi-trial-display-options input:checked~.mwi-trial-switch{background:var(--trial-accent);border-color:var(--trial-accent)}
        #mwi-credit-optimizer .mwi-trial-display-options input:checked~.mwi-trial-switch:after{transform:translateX(12px);background:#191c2e}
        #mwi-credit-optimizer .mwi-trial-display-help{margin-top:12px;border-top:1px solid var(--trial-line)}
        #mwi-credit-optimizer .mwi-trial-display-help summary{width:fit-content;padding:8px 0;cursor:pointer;color:var(--trial-muted)}
        #mwi-credit-optimizer .mwi-trial-columns-empty{max-width:28ch;padding:16px 8px;white-space:normal;color:var(--trial-muted);font-size:12px}
        #mwi-credit-optimizer .mwi-trial-table th[aria-sort="none"] .mwi-trial-sort svg{opacity:.3}
        #mwi-credit-optimizer .mwi-trial-table th[aria-sort="none"] .mwi-trial-sort:is(:hover,:focus-visible) svg{opacity:1}
        #mwi-credit-optimizer .mwi-trial-table td[data-trial-field="healingDone"],#mwi-credit-optimizer .mwi-trial-table td[data-trial-field="premitigatedDamageTaken"]{border-left:1px solid var(--trial-line);padding-left:10px}
        @container mwi-trials (max-width:460px){
          #mwi-credit-optimizer .mwi-trial-display-settings>summary{flex-wrap:wrap;gap:4px 8px}
          #mwi-credit-optimizer .mwi-trial-display-settings>summary small{order:3;flex-basis:100%;margin:0}
          #mwi-credit-optimizer .mwi-trial-display-settings>summary svg{margin-left:auto}
        }
        @media (prefers-reduced-motion:reduce){#mwi-credit-optimizer .mwi-trial-switch:after,#mwi-credit-optimizer .mwi-trial-display-settings>summary svg{transition:none}}
        #mwi-credit-optimizer .mwi-trial-overview{margin:6px 0 8px;font-size:12px;line-height:1.4}
        #mwi-credit-optimizer .mwi-trial-overview dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px 8px;margin:0;padding:4px 0}
        #mwi-credit-optimizer .mwi-trial-overview dt{color:var(--trial-muted);font-weight:normal;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-trial-overview dd{margin:2px 0 0;font-size:13px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-trial-overview p{margin:2px 0 4px;color:var(--trial-muted);overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-trial-display-controls{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;margin:0 0 8px}
        #mwi-credit-optimizer .mwi-trial-choice-field{display:grid;gap:4px;min-width:0;font-size:12px;color:var(--trial-muted)}
        #mwi-credit-optimizer .mwi-trial-choices{display:flex;gap:6px;max-width:100%;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin;padding:2px 2px 4px}
        #mwi-credit-optimizer .mwi-trial-choices button{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;white-space:nowrap;min-height:30px;padding:3px 8px;border:1px solid var(--trial-line);background:transparent;color:var(--trial-muted);font-size:14px}
        #mwi-credit-optimizer .mwi-trial-rankings{margin:12px 0 20px;min-width:0}
        #mwi-credit-optimizer .mwi-trial-week-grid[data-kind="rankings"]{grid-auto-flow:column;grid-auto-columns:max-content}
        #mwi-credit-optimizer .mwi-trial-rankings .mwi-trial-rail{position:relative}
        #mwi-credit-optimizer [data-trial-ranking-column]>h4{min-height:2.8em;text-align:center}
        #mwi-credit-optimizer .mwi-trial-ranking-controls{display:flex;justify-content:center;gap:4px;margin:0 0 8px}
        #mwi-credit-optimizer .mwi-trial-ranking-controls button{display:grid;place-items:center;min-width:32px;min-height:32px;padding:4px}
        #mwi-credit-optimizer [data-trial-ranking-drag]{cursor:grab;touch-action:none;user-select:none}
        #mwi-credit-optimizer [data-trial-ranking-column].mwi-sort-dragging{opacity:.8;cursor:grabbing}
        #mwi-credit-optimizer [data-trial-ranking-column].mwi-sort-drop-before{box-shadow:inset 2px 0 #91dfcb}
        #mwi-credit-optimizer [data-trial-ranking-column].mwi-sort-drop-after{box-shadow:inset -2px 0 #91dfcb}
        #mwi-credit-optimizer .mwi-trial-ranking-table time{white-space:nowrap}
        #mwi-credit-optimizer .mwi-trial-ranking-table{min-width:100%}
        #mwi-credit-optimizer .mwi-trial-ranking-table caption{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
        #mwi-credit-optimizer .mwi-trial-ranking-table :is(th,td):first-child{text-align:center}
        #mwi-credit-optimizer .mwi-trial-ranking-table th:nth-child(2){text-align:left}
        #mwi-credit-optimizer .mwi-trial-player-picker{margin:4px 0 12px}
        #mwi-credit-optimizer .mwi-trial-player-picker>summary{padding:6px 0;cursor:pointer;font-size:14px;color:var(--trial-accent);overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-trial-player-search{margin-top:10px;text-align:left}
        #mwi-credit-optimizer .mwi-trial-player-search label{display:block;margin-bottom:6px}
        #mwi-credit-optimizer .mwi-trial-player-search-bar{display:flex;gap:6px;flex-wrap:wrap;max-width:640px}
        #mwi-credit-optimizer .mwi-trial-player-search-bar input{flex:1 1 200px;min-width:0;width:100%;min-height:36px;padding:6px 10px;border:1px solid var(--trial-line);border-radius:4px;background:var(--trial-field);color:var(--trial-text);font-size:14px;caret-color:var(--trial-accent)}
        #mwi-credit-optimizer .mwi-trial-player-search-bar input::placeholder{color:var(--trial-muted);opacity:1}
        #mwi-credit-optimizer .mwi-trial-player-search-actions{display:flex;gap:6px;flex:0 0 auto}
        #mwi-credit-optimizer .mwi-trial-player-search-bar button{min-height:36px;padding:6px 12px;flex:0 0 auto}
        #mwi-credit-optimizer .mwi-trial-player-search-bar button[type="submit"]{background:#34514e;color:#d5f7ed}
        #mwi-credit-optimizer .mwi-trial-search-count{margin:10px 0 6px;text-align:left}
        #mwi-credit-optimizer .mwi-trial-player-results{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(140px,100%),1fr));overflow:visible;gap:6px;padding:2px}
        #mwi-credit-optimizer .mwi-trial-player-results button{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;min-width:0;min-height:36px;text-align:left;white-space:normal;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-trial-player-results small{font-size:11px;font-weight:normal}
        #mwi-credit-optimizer .mwi-trial-project-icon{width:20px;height:20px;flex:0 0 20px}
        #mwi-credit-optimizer .mwi-trial-choices button:hover{background:var(--trial-surface);color:var(--trial-text)}
        #mwi-credit-optimizer .mwi-trial-choices button[aria-pressed="true"]{border-color:var(--trial-accent);background:#34514e;color:#d5f7ed}
        #mwi-credit-optimizer .mwi-trial-mode{display:flex;flex-wrap:nowrap;gap:4px;padding:2px;max-width:100%;width:fit-content;overflow-x:auto;scrollbar-width:thin;background:var(--trial-field);border-radius:6px}
        #mwi-credit-optimizer .mwi-trial-mode button{flex:0 0 auto;white-space:nowrap;min-height:30px;background:transparent;color:var(--trial-muted);font-size:14px}
        #mwi-credit-optimizer .mwi-trial-mode button[aria-pressed="true"]{background:#34514e;color:#d5f7ed}
        #mwi-credit-optimizer .mwi-trial-group{min-width:0;margin:0 0 16px}
        #mwi-credit-optimizer .mwi-trial-group-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px 12px}
        #mwi-credit-optimizer .mwi-trial-group-header h3{margin:0;font-size:16px;font-weight:650}
        #mwi-credit-optimizer .mwi-trial-scroll-buttons{display:flex;gap:4px;flex-wrap:wrap;margin-left:auto}
        #mwi-credit-optimizer .mwi-trial-rail{max-width:100%;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin;padding:4px 0 12px}
        #mwi-credit-optimizer .mwi-trial-columns{display:grid;align-items:start;justify-content:start;gap:8px}
        #mwi-credit-optimizer .mwi-trial-week-grid[data-kind="skilling"]{grid-template-columns:repeat(4,max-content)}
        #mwi-credit-optimizer .mwi-trial-week-grid[data-kind="combat"]{grid-template-columns:repeat(2,max-content)}
        #mwi-credit-optimizer .mwi-trial-timeline{grid-auto-flow:column;grid-auto-columns:max-content;justify-content:start}
        #mwi-credit-optimizer .mwi-trial-column{width:max-content;min-width:0;border-top:1px solid var(--trial-line);padding-top:6px}
        /* Only member tables determine a project's width; wrap headings, summaries and raw records within it. */
        #mwi-credit-optimizer .mwi-trial-column>h4,#mwi-credit-optimizer .mwi-trial-column .mwi-trial-meta,#mwi-credit-optimizer .mwi-trial-column .mwi-trial-overview,#mwi-credit-optimizer .mwi-trial-column .mwi-trial-raw{contain:inline-size}
        #mwi-credit-optimizer .mwi-trial-column h4{margin:0 0 4px;font-size:14px;font-weight:650;color:var(--trial-accent);overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-trial-record{min-width:0}
        #mwi-credit-optimizer .mwi-trial-record+.mwi-trial-record{border-top:1px solid var(--trial-line);margin-top:16px;padding-top:8px}
        #mwi-credit-optimizer .mwi-trial-record .mwi-trial-table caption{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
        #mwi-credit-optimizer .mwi-trial-empty{margin:0;padding:12px 0;min-height:120px;max-width:32ch;color:var(--trial-muted);font-size:12px;line-height:1.5}
        #mwi-credit-optimizer [data-role="trials-view"] .mwi-trial-heading-link{display:inline-flex;align-items:center;gap:6px;min-height:24px;padding:0;border:0;background:transparent;color:var(--trial-accent);font:inherit;text-align:inherit;white-space:normal}
        #mwi-credit-optimizer [data-role="trials-view"] .mwi-trial-heading-link:hover{background:transparent;text-decoration:underline;text-underline-offset:3px}
        #mwi-credit-optimizer .mwi-trial-player-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin:8px 0 12px}
        #mwi-credit-optimizer .mwi-trial-player-toolbar h3{margin:0;overflow-wrap:anywhere;font-size:16px}
        #mwi-credit-optimizer .mwi-trial-player-layout{display:grid;grid-template-columns:320px minmax(0,1fr);gap:20px;align-items:start}
        #mwi-credit-optimizer .mwi-trial-player-profile,#mwi-credit-optimizer .mwi-trial-player-history{min-width:0}
        #mwi-credit-optimizer .mwi-trial-player-profile{padding-right:16px;border-right:1px solid var(--trial-line)}
        #mwi-credit-optimizer .mwi-trial-player-profile header{display:flex;align-items:center;justify-content:space-between;gap:8px}
        #mwi-credit-optimizer .mwi-trial-player-profile h3{margin:0 0 6px;font-size:14px}
        #mwi-credit-optimizer .mwi-trial-player-profile h4{margin:16px 0 4px;font-size:14px;color:var(--trial-accent)}
        #mwi-credit-optimizer .mwi-trial-profile-section{margin-top:12px}
        #mwi-credit-optimizer .mwi-trial-profile-section>summary{padding:6px 0;min-height:32px;font-size:14px;font-weight:650;color:var(--trial-accent);cursor:pointer;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-trial-profile-section>summary:hover{text-decoration:underline;text-underline-offset:3px}
        #mwi-credit-optimizer .mwi-trial-player-overview{width:100%;table-layout:auto;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
        #mwi-credit-optimizer .mwi-trial-player-overview caption{caption-side:top;text-align:left;padding:10px 0 4px;color:var(--trial-accent);font-weight:650}
        #mwi-credit-optimizer .mwi-trial-player-overview th,#mwi-credit-optimizer .mwi-trial-player-overview td{padding:5px 3px;border-bottom:1px solid var(--trial-line);text-align:right;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-trial-player-overview th:first-child{text-align:left}
        #mwi-credit-optimizer .mwi-trial-overview-name{width:34%}
        #mwi-credit-optimizer .mwi-trial-overview-count{width:10%}
        #mwi-credit-optimizer .mwi-trial-player-overview tfoot th,#mwi-credit-optimizer .mwi-trial-player-overview tfoot td{border-top:2px solid var(--trial-line);font-weight:650;color:var(--trial-accent)}
        #mwi-credit-optimizer .mwi-trial-player-overview thead th{white-space:normal;color:var(--trial-muted);font-weight:500}
        #mwi-credit-optimizer .mwi-trial-player-overview thead th:nth-child(2),#mwi-credit-optimizer .mwi-trial-player-overview thead th:nth-child(3){white-space:nowrap}
        #mwi-credit-optimizer .mwi-trial-player-overview tbody th{font-weight:400}
        #mwi-credit-optimizer .mwi-trial-player-overview tbody th>span{display:flex;align-items:center;gap:5px}
        #mwi-credit-optimizer .mwi-trial-player-overview .mwi-trial-overview-project-name{min-width:0;white-space:normal;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-trial-player-overview td{white-space:nowrap}
        #mwi-credit-optimizer .mwi-trial-overview-help{margin-top:8px;font-size:12px;color:var(--trial-muted)}
        #mwi-credit-optimizer .mwi-trial-overview-help summary{cursor:pointer}
        #mwi-credit-optimizer .mwi-trial-overview-help p{margin:6px 0;line-height:1.5;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-trial-profile-observation{margin:4px 0 8px;color:var(--trial-muted);font-size:12px;line-height:1.4;overflow-wrap:anywhere}
        #mwi-credit-optimizer [data-trial-profile-presence="online"] dd{color:var(--trial-accent)}
        #mwi-credit-optimizer [data-trial-profile-presence="offline"] dd,#mwi-credit-optimizer [data-trial-profile-presence="unknown"] dd{color:var(--trial-muted)}
        #mwi-credit-optimizer [data-trial-profile-presence="hidden"] dd{color:var(--trial-warning)}
        #mwi-credit-optimizer .mwi-trial-profile-facts{margin:8px 0}
        #mwi-credit-optimizer .mwi-trial-profile-facts>div{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:3px 0;border-bottom:1px solid var(--trial-line)}
        #mwi-credit-optimizer .mwi-trial-profile-facts dt{display:flex;align-items:center;gap:6px;min-width:0;color:var(--trial-muted);overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-trial-profile-facts dd{margin:0;max-width:20ch;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-trial-profile-icon{width:20px;height:20px;flex:0 0 20px}
        #mwi-credit-optimizer .mwi-trial-skill-grid,#mwi-credit-optimizer .mwi-trial-equipment-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;margin-top:8px}
        #mwi-credit-optimizer .mwi-trial-equipment-slot{position:relative;display:grid;place-items:center;min-width:0;aspect-ratio:1;border:1px solid #9da5df;border-radius:4px;background:#2c2c45;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-trial-equipment-slot .mwi-trial-profile-icon{width:82%;height:82%}
        #mwi-credit-optimizer .mwi-trial-equipment-empty{align-items:start;border-style:dashed;background:transparent;color:var(--trial-muted);font-size:12px;text-align:center;padding:2px}
        #mwi-credit-optimizer .mwi-trial-equipment-level{position:absolute;left:2px;top:0;font-size:14px;line-height:1.3;color:#eee;font-variant-numeric:tabular-nums;text-shadow:1px 1px 1px #000,-1px -1px 1px #000;pointer-events:none}
        #mwi-credit-optimizer .mwi-trial-skill-house{position:absolute;right:2px;bottom:2px;display:flex;align-items:center;gap:2px;max-width:calc(100% - 4px);padding:1px 3px;border-radius:3px;background:#191c2e;color:var(--trial-accent);font-size:12px;line-height:1.2;font-variant-numeric:tabular-nums;pointer-events:none}
        #mwi-credit-optimizer .mwi-trial-skill-house svg{flex:0 0 11px}
        #mwi-credit-optimizer .mwi-trial-skill-house[data-unknown="true"]{color:var(--trial-muted)}
        #mwi-credit-optimizer .mwi-trial-equipment-level[data-tier="blue"]{color:#87c8eb}
        #mwi-credit-optimizer .mwi-trial-equipment-level[data-tier="purple"]{color:#cb91fa}
        #mwi-credit-optimizer .mwi-trial-equipment-level[data-tier="gold"]{color:#ffac00}
        #mwi-credit-optimizer .mwi-trial-slot-label{padding:3px;font-size:12px;text-align:center}
        #mwi-credit-optimizer .mwi-trial-equipment-extra{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;margin-top:8px}
        #mwi-credit-optimizer .mwi-trial-profile-abilities{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;margin-top:12px}
        .mwi-trial-profile-tooltip{position:fixed;z-index:2147483647;box-sizing:border-box;width:max-content;max-width:min(420px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;padding:10px 12px;border-radius:5px;background:#b6bfe5;color:#10121b;font:14px/1.45 system-ui,-apple-system,"Microsoft YaHei",sans-serif;white-space:pre-line;overflow-wrap:anywhere;box-shadow:0 6px 20px #0005}
        #mwi-credit-optimizer .mwi-trial-ability-slot,#mwi-credit-optimizer .mwi-trial-skill-slot{border-color:transparent}
        @container mwi-trials (max-width:760px){
          #mwi-credit-optimizer .mwi-trial-player-layout{grid-template-columns:minmax(0,1fr);gap:16px}
          #mwi-credit-optimizer .mwi-trial-player-profile{padding:0 0 12px;border-right:0;border-bottom:1px solid var(--trial-line)}
        }
        @container mwi-trials (max-width:460px){
          #mwi-credit-optimizer .mwi-trial-import-list{max-height:280px}
          #mwi-credit-optimizer .mwi-trial-import-list li{grid-template-columns:minmax(0,1fr)}
        }

        /* Explanations keep compact native disclosure markers and readable expanded text. */
        #mwi-credit-optimizer .mwi-settings-help>details+details{border-top:1px solid #41465f;padding-top:6px}
        #mwi-credit-optimizer .mwi-settings-help .mwi-help-sections{padding:4px 2px 12px}
        #mwi-credit-optimizer .mwi-settings-help summary:focus-visible{outline:2px solid #91dfcb;outline-offset:2px}
        #mwi-credit-optimizer [data-role="shrine-guide-detail"]:empty{display:none}
        #mwi-credit-optimizer .mwi-context-help{min-width:0;margin:6px 0;background:transparent;border:0;border-radius:0;color:#b7bfd4}
        #mwi-credit-optimizer details.mwi-context-help>summary.mwi-help-toggle{width:fit-content;max-width:100%;min-height:36px;overflow-wrap:anywhere;cursor:pointer;border:0;border-radius:4px;background:transparent;gap:0;padding:6px 2px;color:#b7bfd4;font-size:13px;font-weight:400;line-height:1.5}
        #mwi-credit-optimizer details.mwi-context-help>summary.mwi-help-toggle:hover{background:transparent;color:#edf0fa;text-decoration:underline;text-underline-offset:3px}
        #mwi-credit-optimizer .mwi-help-heading{min-width:0;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-context-help .mwi-help-intro{max-width:68ch;margin:2px 0 10px;font-size:13px;line-height:1.6;color:#b7bfd4;overflow-wrap:anywhere}
        #mwi-credit-optimizer .mwi-context-help .mwi-help-sections{display:grid;gap:12px;margin:0;padding:0 0 10px;border:0;text-align:left}
        #mwi-credit-optimizer .mwi-help-sections>div{display:grid;gap:3px;min-width:0;max-width:68ch}
        #mwi-credit-optimizer .mwi-help-sections dt{font-size:13px;line-height:1.5;font-weight:600;color:#d7dced}
        #mwi-credit-optimizer .mwi-help-sections dd{min-width:0;margin:0;font-size:13px;line-height:1.65;overflow-wrap:anywhere;color:#b7bfd4}
        #mwi-credit-optimizer .mwi-help-sections dd p{margin:0;font-size:inherit;line-height:inherit;color:inherit}
        #mwi-credit-optimizer .mwi-help-sections dd p+p{margin-top:8px}

  `;

  function shrineGuideStyles(quantityHintId) {
    return `
      [data-mwi-shrine-guide]{--mwi-guide-color:#63e6c8;position:relative!important;z-index:5!important;outline:2px solid color-mix(in srgb,var(--mwi-guide-color) 78%,white 12%)!important;outline-offset:2px!important;box-shadow:0 0 0 4px color-mix(in srgb,var(--mwi-guide-color) 20%,transparent),0 0 18px color-mix(in srgb,var(--mwi-guide-color) 25%,transparent)!important;scroll-margin:16px}
      [data-mwi-shrine-guide="goal"]{outline-style:dashed!important;box-shadow:0 0 0 3px color-mix(in srgb,var(--mwi-guide-color) 13%,transparent)!important}
      [data-mwi-shrine-guide="pending"]{box-shadow:0 0 0 3px color-mix(in srgb,var(--mwi-guide-color) 16%,transparent)!important}
      [data-mwi-shrine-guide="active"]{animation:mwi-shrine-guide-pulse 1.45s ease-in-out infinite}
      input[data-mwi-shrine-guide="active"]{animation:none;filter:none!important;outline-width:1px!important;outline-offset:1px!important;box-shadow:0 0 0 2px color-mix(in srgb,var(--mwi-guide-color) 22%,transparent)!important}
      #${quantityHintId}{position:absolute!important;width:1px!important;height:1px!important;margin:-1px!important;padding:0!important;overflow:hidden!important;clip-path:inset(50%)!important;white-space:nowrap!important;border:0!important}
      @keyframes mwi-shrine-guide-pulse{0%,100%{filter:brightness(1);box-shadow:0 0 0 3px color-mix(in srgb,var(--mwi-guide-color) 20%,transparent),0 0 12px color-mix(in srgb,var(--mwi-guide-color) 22%,transparent)}50%{filter:brightness(1.08);box-shadow:0 0 0 6px color-mix(in srgb,var(--mwi-guide-color) 13%,transparent),0 0 23px color-mix(in srgb,var(--mwi-guide-color) 38%,transparent)}}
      @media (prefers-reduced-motion:reduce){[data-mwi-shrine-guide="active"]{animation:none}}
    `;
  }

  const GUILD_EXCHANGE_ADVISOR_STYLES = `
    :host{all:initial;color-scheme:dark;font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif}*,*::before,*::after{box-sizing:border-box}[hidden]{display:none!important}
    .advisor-stack{--credit:#4fcdb5;position:fixed;z-index:1065;display:grid;width:min(400px,calc(100vw - 24px));max-height:min(calc(100dvh - 24px),var(--advisor-available-height,100dvh));grid-template-rows:minmax(0,1fr) auto;gap:8px;pointer-events:none}
    .advisor{display:flex;min-height:0;flex-direction:column;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#626683 #171927;border:1px solid #414361;border-left:4px solid var(--credit);border-radius:7px;background:#171927;color:#f4f5ff;box-shadow:0 8px 24px rgba(0,0,0,.45);font-size:13px;line-height:1.4;pointer-events:auto}
    .advisor[data-collapsed="true"]{overflow:hidden}.advisor[data-collapsed="true"] .head{border-bottom-color:transparent}.advisor[data-collapsed="true"] .advisor-toggle svg{transform:rotate(0deg)}
    .guide-quantity{display:grid;justify-items:center;gap:2px;padding:10px 12px;border:1px solid #414361;border-radius:7px;background:#171927;color:#f4f5ff;box-shadow:0 6px 18px rgba(0,0,0,.34);font-size:12px;line-height:1.5;text-align:center;pointer-events:auto;cursor:text;user-select:text;-webkit-user-select:text}
    .guide-quantity::selection,.guide-quantity *::selection{background:color-mix(in srgb,var(--credit) 52%,#171927);color:#fff}
    .guide-quantity-summary{max-width:100%;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
    .guide-quantity-detail{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
    .head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:8px 8px 8px 12px;border-bottom:1px solid #414361;background:#24263e}.title{display:grid;min-width:0;gap:2px;font-size:17px;font-weight:700}.credit{display:flex;min-width:0;align-items:center;gap:5px;color:#c7cae4;font-size:11px;font-weight:500}.credit::before{width:9px;height:9px;flex:0 0 9px;border-radius:2px;background:var(--credit);content:""}.head-actions{display:flex;min-width:0;align-items:center;gap:4px}.reference{min-width:0;overflow:hidden;color:#bfc2de;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.advisor-toggle{display:grid;width:36px;height:36px;flex:0 0 36px;place-items:center;padding:0;border:1px solid transparent;border-radius:6px;background:transparent;color:#dfe1f7;cursor:pointer}.advisor-toggle:hover{border-color:#555975;background:#30334f}.advisor-toggle:active{background:#1c1e31}.advisor-toggle:focus-visible{outline:2px solid color-mix(in srgb,var(--credit) 82%,white);outline-offset:1px}.advisor-toggle svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transform:rotate(180deg);transition:transform .18s cubic-bezier(.16,1,.3,1)}.body{display:flex;flex:1;min-height:0;flex-direction:column;gap:9px;padding:11px 12px}.options{display:grid;flex:1;min-height:0;grid-template-columns:minmax(0,1fr) 32px minmax(0,1fr);align-items:stretch;gap:8px}.options.single{grid-template-columns:minmax(0,1fr)}.option{min-width:0;padding:8px;border:1px solid #414361;border-radius:5px;background:#202139}.option.best{border-color:var(--credit);background:#193836}.label{display:block;margin-bottom:6px;color:#bfc2de;font-size:11px}.item{display:flex;align-items:center;gap:6px;min-width:0;color:#fff;font-size:14px;font-weight:700}.item .mwi-item-icon{width:32px;height:32px;flex:0 0 32px}.name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cost{margin:8px 0 5px;color:var(--credit);font-size:23px;font-weight:700;line-height:1}.cost small{margin-left:3px;color:#bfc2de;font-size:11px;font-weight:500}.detail{display:flex;justify-content:space-between;gap:5px;color:#bfc2de;font-size:11px;white-space:nowrap}.detail b{color:#e7e8f6;font-weight:600}.versus{display:grid;place-items:center;color:#aeb1d3;font-size:11px;font-weight:700}.versus span{display:grid;place-items:center;width:28px;height:28px;border:1px solid #58607a;border-radius:50%;background:#151722}.summary{padding:8px;border-top:1px solid #414361;color:#dfe1f7;text-align:center;font-size:12px;font-weight:600}.summary strong{color:var(--credit);font-size:16px}
    @media (pointer:coarse){.advisor-toggle{width:44px;height:44px;flex-basis:44px}}
    @media (prefers-reduced-motion:reduce){.advisor-toggle svg{transition:none}}
    @media (max-width:600px){.advisor-stack{max-height:min(300px,calc(100dvh - 24px),var(--advisor-available-height,100dvh))}.head{padding-block:6px}.options{grid-template-columns:minmax(0,1fr) 28px minmax(0,1fr)}.body{padding:9px}.option{padding:7px}.cost{font-size:20px}}
  `;

  return { PANEL_STYLES, shrineGuideStyles, GUILD_EXCHANGE_ADVISOR_STYLES };
});


// SOURCE: src/ui/construction-view.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildCreditConstructionView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createConstructionView(dependencies) {
    const {
      state,
      buildingDataApi,
      t,
      ui,
      core,
      escapeHtml,
      formatNumber,
      titleCase,
      simpleItemName,
      shrineIdentityValues,
      shrineLevelValue,
      guildBuildingSpriteBaseHref,
      guildBuildingIconMarkup,
      updateRenderedMarkup,
      persistGuildBuildingPlannerState,
      hydrateBridgeData,
      extractItemDetailsFromReact,
      hydrateLocalInitData,
      pageWindow,
      document,
      URL,
      Blob,
      guildTrialFirstStartAt
    } = dependencies;

    const constructionUi = {
      pickerOpen: state.buildingPlans.length === 0,
      expandedBuildingHrids: new Set(),
      guildPointHistoryOpen: false,
      trackedGuildPointEditWeekStarts: new Set(),
      trackedGuildPointEditWarning: null,
      clearUndoPlans: null,
      clearUndoTimer: null
    };

    function guildPointForecastWeekCount() {
      return core.normalizeGuildPointForecastWeeks(state.guildPointForecastWeeks);
    }

    function guildPointPlanningWeekCount() {
      const weeks = Number(state.guildPointPlanningWeeks);
      return Number.isSafeInteger(weeks) && weeks >= 0 && weeks <= 12 ? weeks : 0;
    }

    function guildBuildingDefinitions() {
      return buildingDataApi.definitions();
    }

    function guildBuildingLabel(definition) {
      return definition && definition.nameKey
        ? t(definition.nameKey)
        : titleCase(simpleItemName(definition && definition.hrid));
    }

    function guildBuildingLevelRecordMatches(record, fallbackHrid, buildingHrid) {
      const segment = String(buildingHrid || "")
        .split("/")
        .pop()
        .toLowerCase();
      if (!segment) return false;
      const candidates = shrineIdentityValues(record, fallbackHrid).filter((value) => typeof value === "string");
      return candidates.some((value) => {
        const normalized = value.toLowerCase();
        return normalized === buildingHrid || new RegExp(`(^|[/_-])${segment}([/_-]|$)`).test(normalized);
      });
    }

    function readGuildBuildingLevel(definition) {
      const source = state.guildBuildingLevels;
      if (!source) return null;
      const entries = Array.isArray(source)
        ? source.map((record) => [
            record && (record.guildBuildingHrid || record.guildShrineHrid || record.hrid),
            record
          ])
        : Object.entries(source);
      for (const [fallbackHrid, record] of entries) {
        if (!guildBuildingLevelRecordMatches(record, fallbackHrid, definition.hrid)) continue;
        const level = shrineLevelValue(record);
        if (level !== null) return Math.min(level, definition.maxLevel);
      }
      return null;
    }

    function currentGuildBuildingLevel(definition) {
      return readGuildBuildingLevel(definition) ?? 0;
    }

    function guildBuildingLevelSnapshot(definitions) {
      const complete = state.guildBuildingLevelsComplete === true;
      const levels = new Map();
      const knownHrids = new Set();
      for (const definition of definitions) {
        const readLevel = readGuildBuildingLevel(definition);
        levels.set(definition.hrid, readLevel ?? 0);
        if (readLevel !== null || complete) knownHrids.add(definition.hrid);
      }
      return { levels, knownHrids, knownCount: knownHrids.size, totalCount: definitions.length };
    }

    function reconcileGuildBuildingPlans(definitions) {
      const byHrid = new Map(definitions.map((definition) => [definition.hrid, definition]));
      let changed = false;
      let adjustedCount = 0;
      let removedCount = 0;
      const reconciled = [];
      for (const plan of state.buildingPlans) {
        const definition = byHrid.get(plan.buildingHrid);
        if (!definition) {
          changed = true;
          removedCount += 1;
          continue;
        }
        const startLevel = currentGuildBuildingLevel(definition);
        const targetLevel = Math.max(0, Math.min(definition.maxLevel, Number(plan.targetLevel) || 0));
        if (targetLevel <= startLevel) {
          changed = true;
          removedCount += 1;
          continue;
        }
        if (startLevel !== plan.startLevel || targetLevel !== plan.targetLevel) {
          changed = true;
          adjustedCount += 1;
        }
        reconciled.push({ ...plan, startLevel, targetLevel });
      }
      if (changed) {
        state.buildingPlans = reconciled;
        persistGuildBuildingPlannerState();
        if (!state.buildingPlanNotice)
          state.buildingPlanNotice = t("buildingPlansReconciled", {
            adjusted: formatNumber(adjustedCount),
            removed: formatNumber(removedCount)
          });
      }
      return { changed, adjustedCount, removedCount };
    }

    function guildPointPlanningBudget(historySummary) {
      const liveAvailable = state.guildPointSummary && state.guildPointSummary.availablePoints;
      const basePoints = state.manualGuildPoints === null ? liveAvailable : state.manualGuildPoints;
      const weeks = guildPointPlanningWeekCount();
      const forecast = guildPointForecastBasis(historySummary);
      const planning = core.calculateGuildPointPlanningBudget(basePoints, forecast.nextWeekForecastPoints, weeks, {
        currentWeekRemaining: forecast.currentWeekRemaining
      });
      return {
        ...planning,
        canProject: planning.status === "ok"
      };
    }

    function guildBuildingPlan(definitions, historySummary) {
      reconcileGuildBuildingPlans(definitions);
      const byHrid = new Map(definitions.map((definition) => [definition.hrid, definition]));
      const planning = guildPointPlanningBudget(historySummary);
      return {
        ...core.buildGuildConstructionPlan(
          state.buildingPlans.map((plan) => ({
            ...plan,
            levelCosts: byHrid.get(plan.buildingHrid) && byHrid.get(plan.buildingHrid).levelCosts
          })),
          planning.budget
        ),
        planning
      };
    }

    function syncGuildPointHistory() {
      const summary = state.guildPointSummary;
      if (!summary || state.guildPointSummaryCached) return guildPointHistorySummary();
      const update = core.recordGuildPointObservation(state.guildPointHistory, {
        guildId: summary.guildId,
        lifetimePoints: summary.lifetimePoints,
        availablePoints: summary.availablePoints,
        weekStartAt: state.guildWeekStartAt,
        observedAt: Date.now()
      });
      if (update.changed) {
        state.guildPointHistory = update.history;
        persistGuildBuildingPlannerState();
      }
      return guildPointHistorySummary();
    }

    function supplementedGuildPointHistory() {
      const summary = state.guildPointSummary;
      if (!summary) return { history: state.guildPointHistory, estimatedCount: 0 };
      return core.supplementGuildPointHistory(
        state.guildPointHistory,
        summary.lifetimePoints,
        currentGuildWeekPoints(),
        Date.now(),
        guildTrialFirstStartAt,
        { forecastWeekCount: guildPointForecastWeekCount() }
      );
    }

    function currentGuildWeekPoints() {
      const currentWeekStartAt =
        guildTrialFirstStartAt +
        Math.floor((Date.now() - guildTrialFirstStartAt) / (7 * 24 * 60 * 60 * 1000)) * 7 * 24 * 60 * 60 * 1000;
      if (
        state.guildWeekStartAt &&
        Math.floor((state.guildWeekStartAt - guildTrialFirstStartAt) / (7 * 24 * 60 * 60 * 1000)) !==
          Math.floor((currentWeekStartAt - guildTrialFirstStartAt) / (7 * 24 * 60 * 60 * 1000))
      )
        return null;
      const value = state.guildPointSummary?.currentWeekPoints;
      return Number.isSafeInteger(value) && value >= 0 ? value : null;
    }

    function guildPointHistorySummary() {
      const supplemented = supplementedGuildPointHistory();
      const currentWeekStartAt =
        guildTrialFirstStartAt +
        Math.floor((Date.now() - guildTrialFirstStartAt) / (7 * 24 * 60 * 60 * 1000)) * 7 * 24 * 60 * 60 * 1000;
      // Keep observed values for fitting; auto-fill is only a display aid.
      const weeksByStart = new Map(
        [...(supplemented.history?.weeks || []), ...(state.guildPointHistory?.weeks || [])].map((record) => [
          record.weekStartAt,
          record
        ])
      );
      const history = core.summarizeGuildPointHistory(
        { ...supplemented.history, weeks: [...weeksByStart.values()] },
        {
          forecastWeekCount: guildPointForecastWeekCount(),
          currentWeekStartAt,
          currentWeekPoints: currentGuildWeekPoints()
        }
      );
      return {
        ...history,
        ...(supplemented.status === "known_points_exceed_total"
          ? { forecastPoints: null, nextWeekForecastPoints: null, averageWeeklyChange: null, forecastSampleCount: 0 }
          : {}),
        supplemented
      };
    }

    function guildPointWeekLabel(weekStartAt) {
      try {
        const date = new Intl.DateTimeFormat(ui().locale, { month: "numeric", day: "numeric" }).format(
          new Date(weekStartAt)
        );
        const ordinal = Math.floor((Number(weekStartAt) - guildTrialFirstStartAt) / (7 * 24 * 60 * 60 * 1000)) + 1;
        return Number.isSafeInteger(ordinal) && ordinal > 0
          ? t("guildPointWeekWithDate", { count: formatNumber(ordinal), date })
          : date;
      } catch (_) {
        return "-";
      }
    }

    function guildPointEta(plan, history) {
      const forecast = guildPointForecastBasis(history);
      if (forecast.hasConflict)
        return { status: "history_conflict", shortfall: null, weeks: null, weeklyForecast: null };
      return core.estimateGuildConstructionWeeks(
        plan.totalCost,
        plan.planning.basePoints,
        forecast.nextWeekForecastPoints,
        { currentWeekRemaining: forecast.currentWeekRemaining }
      );
    }

    function guildPointForecastBasis(historySummary) {
      const history = historySummary || guildPointHistorySummary();
      const hasConflict = history.supplemented?.status === "known_points_exceed_total";
      const effectiveForecastPoints = hasConflict ? null : history.forecastPoints;
      const currentWeekPoints = currentGuildWeekPoints();
      const currentWeekTotal =
        currentWeekPoints > 0
          ? currentWeekPoints
          : Number.isSafeInteger(effectiveForecastPoints) && Number.isSafeInteger(currentWeekPoints)
            ? Math.max(effectiveForecastPoints, currentWeekPoints)
            : null;
      return {
        ...history,
        hasConflict,
        effectiveForecastPoints,
        currentWeekPoints,
        currentWeekTotal,
        currentWeekRemaining: hasConflict || currentWeekTotal === null ? null : currentWeekTotal - currentWeekPoints,
        nextWeekForecastPoints: hasConflict ? null : history.nextWeekForecastPoints,
        forecastSource: "tracked"
      };
    }

    function manualGuildPointWeekStarts() {
      const elapsedWeeks = Math.max(0, Math.floor((Date.now() - guildTrialFirstStartAt) / (7 * 24 * 60 * 60 * 1000)));
      return Array.from(
        { length: elapsedWeeks },
        (_, index) => guildTrialFirstStartAt + index * 7 * 24 * 60 * 60 * 1000
      ).reverse();
    }

    function renderCurrentGuildPointWeek() {
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      const elapsedWeeks = Math.floor((Date.now() - guildTrialFirstStartAt) / weekMs);
      const fallbackWeekStartAt =
        Number.isSafeInteger(guildTrialFirstStartAt) && elapsedWeeks >= 0
          ? guildTrialFirstStartAt + elapsedWeeks * weekMs
          : null;
      const trackedWeekIndex = Number.isSafeInteger(state.guildWeekStartAt)
        ? Math.floor((state.guildWeekStartAt - guildTrialFirstStartAt) / weekMs)
        : null;
      const weekStartAt =
        Number.isSafeInteger(state.guildWeekStartAt) && state.guildWeekStartAt > 0 && trackedWeekIndex === elapsedWeeks
          ? state.guildWeekStartAt
          : fallbackWeekStartAt;
      if (!weekStartAt) return "";

      const currentWeekPoints = currentGuildWeekPoints();
      const source = currentWeekPoints === null ? "currentUnavailable" : "current";
      const points = currentWeekPoints === null ? "-" : formatNumber(currentWeekPoints);
      const week = guildPointWeekLabel(weekStartAt);
      return `<tr data-source="${source}" data-current-week="true" aria-label="${escapeHtml(t("currentGuildPointWeek"))}"><th scope="row"><time datetime="${new Date(weekStartAt).toISOString()}">${escapeHtml(week)}</time><small class="mwi-guild-point-current-label">${escapeHtml(t("currentGuildPointWeek"))}</small></th><td><strong class="mwi-guild-point-readonly" data-role="current-week-guild-points">${escapeHtml(points)}</strong></td><td><small>${escapeHtml(t(`guildPointSource${source[0].toUpperCase()}${source.slice(1)}`))}</small></td></tr>`;
    }

    function renderNextGuildPointWeek(history) {
      if (!(history.currentWeekPoints > 0) || history.currentWeekStartAt < guildTrialFirstStartAt) return "";
      const weekStartAt = history.currentWeekStartAt + 7 * 24 * 60 * 60 * 1000;
      const points = Number.isSafeInteger(history.nextWeekForecastPoints)
        ? formatNumber(history.nextWeekForecastPoints)
        : "-";
      return `<tr data-source="forecast" data-next-week="true"><th scope="row"><time datetime="${new Date(weekStartAt).toISOString()}">${escapeHtml(guildPointWeekLabel(weekStartAt))}</time></th><td><strong class="mwi-guild-point-readonly" data-role="next-week-guild-points">${escapeHtml(points)}</strong></td><td><small>${escapeHtml(t("guildPointSourceNextForecast"))}</small></td></tr>`;
    }

    function renderManualGuildPointHistory(history) {
      const recordsByWeek = new Map(history.weeks.map((record) => [record.weekStartAt, record]));
      const trackedByWeek = new Map(
        (state.guildPointHistory?.weeks || [])
          .filter((record) => record.weekStartAt < history.currentWeekStartAt)
          .map((record) => [record.weekStartAt, record])
      );
      const manualByWeek = new Map(
        (state.guildPointHistory?.manualWeeks || []).map((record) => [record.weekStartAt, record])
      );
      const rows = manualGuildPointWeekStarts()
        .map((weekStartAt) => {
          const record = recordsByWeek.get(weekStartAt);
          const trackedRecord = trackedByWeek.get(weekStartAt);
          const manualRecord = manualByWeek.get(weekStartAt);
          const trackedEditEnabled =
            Boolean(trackedRecord) && constructionUi.trackedGuildPointEditWeekStarts.has(weekStartAt);
          const source =
            manualRecord && trackedRecord
              ? "manualOverride"
              : trackedEditEnabled
                ? "trackedEditing"
                : trackedRecord && trackedRecord.coverage !== "verified"
                  ? "partial"
                  : record
                    ? ["manual", "estimated"].includes(record.source)
                      ? record.source
                      : "tracked"
                    : "empty";
          const week = guildPointWeekLabel(weekStartAt);
          const value = manualRecord
            ? manualRecord.earnedPoints
            : trackedEditEnabled
              ? trackedRecord.earnedPoints
              : source === "manual"
                ? record.earnedPoints
                : "";
          const placeholder = source === "estimated" ? formatNumber(record.earnedPoints) : "";
          const input = `<input data-role="manual-guild-point-earned" data-week-start-at="${weekStartAt}"${trackedRecord ? ` data-tracked-original-points="${trackedRecord.earnedPoints}"` : ""} type="number" min="0" step="1" inputmode="numeric" aria-label="${escapeHtml(t("manualGuildPointEarnedForWeek", { week }))}" value="${value}"${placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : ""}>`;
          const points = ["tracked", "partial"].includes(source)
            ? `<span class="mwi-guild-point-tracked-value"><strong class="mwi-guild-point-readonly">${formatNumber(trackedRecord.earnedPoints)}</strong><button data-role="edit-tracked-guild-point-week" data-week-start-at="${weekStartAt}" type="button" aria-label="${escapeHtml(t("editTrackedGuildPointWeek", { week }))}">${escapeHtml(t("editTrackedGuildPointWeekShort"))}</button></span>`
            : input;
          return `<tr data-source="${source}"><th scope="row"><time datetime="${new Date(weekStartAt).toISOString()}">${escapeHtml(week)}</time></th><td>${points}</td><td><small>${escapeHtml(t(`guildPointSource${source[0].toUpperCase()}${source.slice(1)}`))}</small></td></tr>`;
        })
        .join("");
      const currentWeekRow = renderCurrentGuildPointWeek(history);
      const nextWeekRow = renderNextGuildPointWeek(history);
      const body =
        rows || currentWeekRow
          ? `<div class="mwi-guild-point-table-scroll"><table><thead><tr><th scope="col">${escapeHtml(t("manualGuildPointWeek"))}</th><th scope="col">${escapeHtml(t("manualGuildPointEarned"))}</th><th scope="col">${escapeHtml(t("guildPointHistorySource"))}</th></tr></thead><tbody>${nextWeekRow}${currentWeekRow}${rows}</tbody></table></div>`
          : `<p class="mwi-guild-point-history-empty">${escapeHtml(t("manualGuildPointHistoryEmpty"))}</p>`;
      const warning = renderTrackedGuildPointEditWarning();
      return `<details class="mwi-guild-point-history"${constructionUi.guildPointHistoryOpen ? " open" : ""}><summary class="mwi-guild-point-history-toggle"><span>${escapeHtml(t("recentGuildPointHistory"))}</span>${constructionIcon("chevron")}</summary><form class="mwi-guild-point-manual-form" data-role="manual-guild-point-form">${body}<div class="mwi-guild-point-manual-footer"><button data-role="save-manual-guild-point-history" type="button"${rows ? "" : " disabled"}>${escapeHtml(t("saveManualGuildPointHistory"))}</button></div></form>${warning}</details>`;
    }

    function renderTrackedGuildPointEditWarning() {
      const warning = constructionUi.trackedGuildPointEditWarning;
      if (!warning) return "";
      const week = guildPointWeekLabel(warning.weekStartAt);
      return `<div class="mwi-guild-point-dialog-layer" data-role="tracked-guild-point-edit-dialog" role="alertdialog" aria-modal="true" aria-labelledby="mwi-tracked-edit-title" aria-describedby="mwi-tracked-edit-description"><section class="mwi-guild-point-dialog"><svg class="mwi-guild-point-dialog-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 21 20H3L12 3.5Z"></path><path d="M12 9v5"></path><circle cx="12" cy="17" r=".7"></circle></svg><div class="mwi-guild-point-dialog-copy"><h4 id="mwi-tracked-edit-title">${escapeHtml(t("trackedGuildPointEditWarningTitle"))}</h4><p id="mwi-tracked-edit-description">${escapeHtml(t("trackedGuildPointEditWarningBody", { week, points: formatNumber(warning.earnedPoints) }))}</p><small>${escapeHtml(t("trackedGuildPointEditWarningHint"))}</small></div><div class="mwi-guild-point-dialog-actions"><button data-role="cancel-tracked-guild-point-edit" type="button">${escapeHtml(t("cancelTrackedGuildPointEdit"))}</button><button class="mwi-guild-point-dialog-confirm" data-role="confirm-tracked-guild-point-edit" data-week-start-at="${warning.weekStartAt}" type="button">${escapeHtml(t("confirmTrackedGuildPointEdit"))}</button></div></section></div>`;
    }

    function setGuildPointHistoryOpen(open) {
      constructionUi.guildPointHistoryOpen = Boolean(open);
    }

    function openTrackedGuildPointEditWarning(weekStartAt) {
      const normalizedWeekStartAt = Number(weekStartAt);
      const record = (state.guildPointHistory?.weeks || []).find(
        (candidate) =>
          candidate.weekStartAt < Date.now() - 7 * 24 * 60 * 60 * 1000 &&
          candidate.weekStartAt === normalizedWeekStartAt
      );
      if (!record) return false;
      constructionUi.trackedGuildPointEditWarning = {
        weekStartAt: normalizedWeekStartAt,
        earnedPoints: record.earnedPoints
      };
      constructionUi.guildPointHistoryOpen = true;
      return true;
    }

    function cancelTrackedGuildPointEditWarning() {
      const warning = constructionUi.trackedGuildPointEditWarning;
      constructionUi.trackedGuildPointEditWarning = null;
      return warning ? warning.weekStartAt : null;
    }

    function confirmTrackedGuildPointEditWarning() {
      const warning = constructionUi.trackedGuildPointEditWarning;
      if (!warning) return null;
      constructionUi.trackedGuildPointEditWeekStarts.add(warning.weekStartAt);
      constructionUi.trackedGuildPointEditWarning = null;
      return warning.weekStartAt;
    }

    function constructionIcon(name) {
      const paths = {
        up: '<path d="M8 13V3m-4 4 4-4 4 4"/>',
        down: '<path d="M8 3v10m-4-4 4 4 4-4"/>',
        add: '<path d="M8 3v10M3 8h10"/>',
        chevron: '<path d="m4 6 4 4 4-4"/>',
        close: '<path d="m4 4 8 8M12 4l-8 8"/>',
        more: '<circle cx="3" cy="8" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="13" cy="8" r="1"/>'
      };
      return `<svg class="mwi-construction-icon" viewBox="0 0 16 16" aria-hidden="true">${paths[name]}</svg>`;
    }

    function renderGuildPointWeekStepper(role, value, minimum, maximum, labelKey, increaseKey, decreaseKey) {
      const label = escapeHtml(t(labelKey));
      const increase = escapeHtml(t(increaseKey));
      const decrease = escapeHtml(t(decreaseKey));
      return `<span class="mwi-number-stepper mwi-guild-point-week-stepper"><input data-role="${role}" type="number" min="${minimum}" max="${maximum}" step="1" inputmode="numeric" value="${value}" aria-label="${label}"><span class="mwi-stepper-buttons"><button class="mwi-stepper-button mwi-stepper-up" data-role="number-step" data-input-role="${role}" data-direction="1" type="button" aria-label="${increase}" title="${increase}"><svg viewBox="0 0 16 10" aria-hidden="true"><path d="M2 8 8 2l6 6"></path></svg></button><button class="mwi-stepper-button mwi-stepper-down" data-role="number-step" data-input-role="${role}" data-direction="-1" type="button" aria-label="${decrease}" title="${decrease}"><svg viewBox="0 0 16 10" aria-hidden="true"><path d="M2 2l6 6 6-6"></path></svg></button></span></span>`;
    }

    function guildPointPlanningSummary(planning) {
      return planning.basePoints === null
        ? t("guildPointPlanningNeedsBalance")
        : planning.weeks > 0 && !planning.canProject
          ? t("guildPointPlanningNeedsForecast")
          : planning.weeks > 0
            ? t("guildPointPlanningBudgetProjected", {
                current: formatNumber(planning.basePoints),
                weeks: formatNumber(planning.futureWeeks),
                remaining: formatNumber(planning.currentWeekRemaining),
                weekly: formatNumber(planning.forecastPoints),
                total: formatNumber(planning.budget)
              })
            : t("guildPointPlanningBudgetCurrent", { total: formatNumber(planning.budget) });
    }

    function renderGuildPointForecastSettings() {
      const forecastWeeks = guildPointForecastWeekCount();
      const forecastStepper = renderGuildPointWeekStepper(
        "guild-point-forecast-weeks",
        forecastWeeks,
        2,
        12,
        "guildPointForecastWeeks",
        "increaseGuildPointForecastWeeks",
        "decreaseGuildPointForecastWeeks"
      );
      return `<section class="mwi-guild-point-planning-options" aria-label="${escapeHtml(t("guildPointPlanningOptions"))}"><label><span>${escapeHtml(t("guildPointForecastWeeks"))}</span>${forecastStepper}</label></section>`;
    }

    function renderGuildPointForecastControls(plan) {
      const planningWeeks = guildPointPlanningWeekCount();
      const planning = plan.planning;
      const planningStepper = renderGuildPointWeekStepper(
        "guild-point-planning-weeks",
        planningWeeks,
        0,
        12,
        "guildPointPlanningWeeks",
        "increaseGuildPointPlanningWeeks",
        "decreaseGuildPointPlanningWeeks"
      );
      return `<div class="mwi-guild-point-controls"><div class="mwi-construction-budget-input"><label><span>${escapeHtml(t("guildPointStartingBalance"))}</span><input data-role="guild-point-budget" type="number" min="0" step="1" aria-describedby="mwi-guild-point-budget-error" placeholder="${escapeHtml(t("guildPointFollowBalance"))}" value="${state.manualGuildPoints === null ? "" : state.manualGuildPoints}"></label><small id="mwi-guild-point-budget-error" class="mwi-field-error" hidden>${escapeHtml(t("invalidGuildPointBudget"))}</small></div><label><span>${escapeHtml(t("guildPointPlanningWeeks"))}</span>${planningStepper}</label><output data-role="guild-point-planning-summary" data-state="${planning.basePoints === null || (planning.weeks > 0 && !planning.canProject) ? "warning" : "ready"}">${escapeHtml(guildPointPlanningSummary(planning))}</output></div>`;
    }

    function renderGuildPointEta(plan, history) {
      const forecast = guildPointForecastBasis(history);
      const eta = guildPointEta(plan, forecast);
      const copy = {
        no_plan: [t("constructionEtaNoPlan"), ""],
        missing_balance: ["-", t("constructionEtaNeedsBalance")],
        missing_forecast: ["-", t("constructionEtaNeedsForecast")],
        history_conflict: ["-", t("constructionEtaHistoryConflict")],
        no_growth: ["-", t("constructionEtaNoGrowth")],
        covered: [t("constructionEtaCovered"), ""],
        ok: [t("constructionEtaWeeks", { count: formatNumber(eta.weeks) }), ""]
      }[eta.status];
      return `<div class="mwi-guild-point-eta" data-status="${eta.status}"><small>${escapeHtml(t("constructionEta"))}</small><strong data-role="construction-eta">${escapeHtml(copy[0])}</strong>${copy[1] ? `<span data-role="construction-eta-detail">${escapeHtml(copy[1])}</span>` : ""}</div>`;
    }

    function renderGuildPointForecast(historySummary) {
      const history = guildPointForecastBasis(historySummary);
      const show = (value) => (Number.isSafeInteger(value) ? formatNumber(value) : "-");
      const metrics = [
        ["currentWeekGuildPoints", "latest-weekly-guild-points", history.currentWeekPoints],
        ["predictedCurrentWeekGuildPoints", "current-week-total-forecast", history.currentWeekTotal],
        ["remainingCurrentWeekGuildPoints", "current-week-remaining-forecast", history.currentWeekRemaining],
        ["nextWeekGuildPointForecast", "next-week-guild-point-forecast", history.nextWeekForecastPoints]
      ];
      const status = !state.guildPointSummary
        ? t("guildPointHistoryUnavailable")
        : history.hasConflict
          ? t("guildPointHistoryConflict")
          : history.forecastPoints === null
            ? t("guildPointForecastNeedsHistory")
            : "";
      const growth = history.growthRate;
      const growthText = Number.isFinite(growth) ? `${growth > 0 ? "+" : ""}${formatNumber(growth * 100, 1)}%` : "-";
      const canExport = history.trackedWeeks.length > 0;
      const canReset = Boolean(state.guildPointHistory?.lastObservation || history.trackedWeeks.length);
      return `<section class="mwi-guild-point-forecast" aria-label="${escapeHtml(t("guildPointStatisticsHeading"))}"><div class="mwi-guild-point-forecast-heading"><span><h4>${escapeHtml(t("guildPointStatisticsHeading"))}</h4></span><span class="mwi-guild-point-autosaved" data-source="${state.guildPointSummaryCached ? "cache" : "live"}">${escapeHtml(t(state.guildPointSummaryCached ? "guildPointSavedSnapshot" : "guildPointAutoSaved"))}</span></div><div class="mwi-guild-point-forecast-grid" data-source="${history.forecastSource}">${metrics.map(([label, role, value]) => `<div><small>${escapeHtml(t(label))}</small><strong data-role="${role}">${escapeHtml(show(value))}</strong></div>`).join("")}</div><div class="mwi-guild-point-forecast-footer"><p class="mwi-guild-point-forecast-status">${status ? `${escapeHtml(status)}<br>` : ""}${escapeHtml(t("weeklyGuildPointGrowth"))}：<span data-role="weekly-guild-point-growth">${escapeHtml(growthText)}</span></p><span class="mwi-guild-point-history-actions"><button data-role="export-guild-point-history" type="button"${canExport ? "" : " disabled"}>${escapeHtml(t("exportGuildPointHistory"))}</button><button data-role="reset-guild-point-history" type="button"${canReset ? "" : " disabled"}>${escapeHtml(t("resetGuildPointHistory"))}</button></span></div>${renderGuildPointForecastSettings()}${renderManualGuildPointHistory(history)}</section>`;
    }

    function discardGuildBuildingClearUndo() {
      if (constructionUi.clearUndoTimer !== null) pageWindow.clearTimeout(constructionUi.clearUndoTimer);
      constructionUi.clearUndoTimer = null;
      constructionUi.clearUndoPlans = null;
    }

    function setGuildBuildingPickerOpen(open) {
      constructionUi.pickerOpen = Boolean(open);
      return constructionUi.pickerOpen;
    }

    function addGuildBuildingPlan(definitions, buildingHrid) {
      const definition = definitions.find((entry) => entry.hrid === buildingHrid);
      if (!definition) return { status: "not_found", buildingHrid };
      const existing = state.buildingPlans.find((plan) => plan.buildingHrid === buildingHrid);
      if (existing) return { status: "already_planned", buildingHrid, plan: existing };
      const startLevel = currentGuildBuildingLevel(definition);
      if (startLevel >= definition.maxLevel) {
        return { status: "at_max_level", buildingHrid };
      }
      discardGuildBuildingClearUndo();
      const plan = {
        id: `building-plan-${state.nextBuildingPlanId++}`,
        buildingHrid,
        startLevel,
        targetLevel: startLevel + 1
      };
      state.buildingPlans.push(plan);
      state.buildingPlanNotice = t("buildingAddedToPlan", { building: guildBuildingLabel(definition) });
      persistGuildBuildingPlannerState();
      return { status: "added", buildingHrid, plan };
    }

    function setGuildBuildingTarget(definitions, buildingHrid, targetLevel) {
      const definition = definitions.find((entry) => entry.hrid === buildingHrid);
      const planIndex = state.buildingPlans.findIndex((entry) => entry.buildingHrid === buildingHrid);
      if (!definition || planIndex < 0) return false;
      const plan = state.buildingPlans[planIndex];
      const target = Number(targetLevel);
      if (!Number.isSafeInteger(target) || target <= plan.startLevel || target > definition.maxLevel) return false;
      if (target === plan.targetLevel) return false;
      discardGuildBuildingClearUndo();
      state.buildingPlans[planIndex] = { ...plan, targetLevel: target };
      state.buildingPlanNotice = t("buildingTargetUpdated", {
        building: guildBuildingLabel(definition),
        target: formatNumber(target)
      });
      persistGuildBuildingPlannerState();
      return true;
    }

    function removeGuildBuildingPlan(definitions, buildingHrid) {
      const index = state.buildingPlans.findIndex((plan) => plan.buildingHrid === buildingHrid);
      if (index < 0) return { status: "not_found", removedIndex: -1 };
      const definition = definitions.find((entry) => entry.hrid === buildingHrid);
      discardGuildBuildingClearUndo();
      const [removed] = state.buildingPlans.splice(index, 1);
      constructionUi.expandedBuildingHrids.delete(buildingHrid);
      state.buildingPlanNotice = t("buildingRemovedFromPlan", { building: guildBuildingLabel(definition) });
      persistGuildBuildingPlannerState();
      return { status: "removed", removedIndex: index, plan: removed };
    }

    function moveGuildBuildingPlan(buildingHrid, direction) {
      const index = state.buildingPlans.findIndex((plan) => plan.buildingHrid === buildingHrid);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= state.buildingPlans.length) return false;
      discardGuildBuildingClearUndo();
      const [plan] = state.buildingPlans.splice(index, 1);
      state.buildingPlans.splice(nextIndex, 0, plan);
      const definition = guildBuildingDefinitions().find((entry) => entry.hrid === buildingHrid);
      state.buildingPlanNotice = t("buildingPlanMovedToPosition", {
        building: guildBuildingLabel(definition),
        position: formatNumber(nextIndex + 1),
        total: formatNumber(state.buildingPlans.length)
      });
      persistGuildBuildingPlannerState();
      return true;
    }

    function reorderGuildBuildingPlan(buildingHrid, targetIndex) {
      const index = state.buildingPlans.findIndex((plan) => plan.buildingHrid === buildingHrid);
      const nextIndex = Math.max(0, Math.min(state.buildingPlans.length - 1, Number(targetIndex)));
      if (index < 0 || !Number.isInteger(nextIndex) || index === nextIndex) return false;
      discardGuildBuildingClearUndo();
      const [plan] = state.buildingPlans.splice(index, 1);
      state.buildingPlans.splice(nextIndex, 0, plan);
      const definition = guildBuildingDefinitions().find((entry) => entry.hrid === buildingHrid);
      state.buildingPlanNotice = t("buildingPlanMovedToPosition", {
        building: guildBuildingLabel(definition),
        position: formatNumber(nextIndex + 1),
        total: formatNumber(state.buildingPlans.length)
      });
      persistGuildBuildingPlannerState();
      return true;
    }

    function toggleGuildBuildingSteps(buildingHrid) {
      if (constructionUi.expandedBuildingHrids.has(buildingHrid)) {
        constructionUi.expandedBuildingHrids.delete(buildingHrid);
        return false;
      }
      constructionUi.expandedBuildingHrids.add(buildingHrid);
      return true;
    }

    function clearGuildBuildingPlans(onUndoExpired) {
      if (!state.buildingPlans.length) return false;
      discardGuildBuildingClearUndo();
      const plans = state.buildingPlans.map((plan) => ({ ...plan }));
      constructionUi.clearUndoPlans = plans;
      constructionUi.expandedBuildingHrids.clear();
      state.buildingPlans = [];
      constructionUi.pickerOpen = true;
      state.buildingPlanNotice = t("buildingPlanCleared", { count: formatNumber(plans.length) });
      persistGuildBuildingPlannerState();
      constructionUi.clearUndoTimer = pageWindow.setTimeout(() => {
        constructionUi.clearUndoPlans = null;
        constructionUi.clearUndoTimer = null;
        if (typeof onUndoExpired === "function") onUndoExpired();
      }, 8000);
      return true;
    }

    function undoClearGuildBuildingPlans() {
      if (!constructionUi.clearUndoPlans) return false;
      const plans = constructionUi.clearUndoPlans.map((plan) => ({ ...plan }));
      discardGuildBuildingClearUndo();
      state.buildingPlans = plans;
      constructionUi.pickerOpen = false;
      state.buildingPlanNotice = "";
      reconcileGuildBuildingPlans(guildBuildingDefinitions());
      state.buildingPlanNotice = t("buildingPlanRestored", { count: formatNumber(state.buildingPlans.length) });
      persistGuildBuildingPlannerState();
      return true;
    }

    function hasGuildBuildingClearUndo() {
      return Boolean(constructionUi.clearUndoPlans);
    }

    function constructionCategoryLabel(category) {
      return t(
        {
          all: "buildingCategoryAll",
          core: "buildingCategoryCore",
          life: "buildingCategoryLife",
          combat: "buildingCategoryCombat",
          shrine: "buildingCategoryShrine"
        }[category] || "buildingCategoryAll"
      );
    }

    function guildConstructionBudgetSummary(plan, definitions) {
      if (!plan.steps.length) return "";
      if (plan.availableGuildPoints === null)
        return t("constructionNoBudgetSummary", { total: formatNumber(plan.steps.length) });
      if (!plan.overBudget) return t("constructionBudgetAllFit", { total: formatNumber(plan.steps.length) });
      const cutoff = plan.steps[plan.firstOverBudgetIndex];
      const definition = definitions.find((entry) => entry.hrid === cutoff.buildingHrid);
      return t("constructionBudgetStopsBefore", {
        affordable: formatNumber(plan.affordableStepCount),
        total: formatNumber(plan.steps.length),
        building: guildBuildingLabel(definition),
        from: formatNumber(cutoff.fromLevel),
        to: formatNumber(cutoff.toLevel),
        count: formatNumber(Math.max(0, -cutoff.remainingGuildPoints))
      });
    }

    function renderGuildBuildingBudget(plan, definitions) {
      const hasBudget = plan.availableGuildPoints !== null;
      const remaining = plan.remainingGuildPoints;
      const remainingLabel = !hasBudget ? "-" : formatNumber(Math.abs(remaining));
      const remainingTitle = hasBudget && remaining < 0 ? t("overBudgetBy") : t("remainingPoints");
      const coverageLabel = hasBudget ? t("affordableUpgrades") : t("plannedUpgrades");
      const coverageValue = hasBudget
        ? `${formatNumber(plan.affordableStepCount)} / ${formatNumber(plan.steps.length)}`
        : formatNumber(plan.steps.length);
      return `<section class="mwi-construction-budget" data-over-budget="${String(Boolean(plan.overBudget))}">
        <div class="mwi-construction-metric"><small>${escapeHtml(t("plannedSpend"))}</small><strong data-role="construction-planned-spend">${formatNumber(plan.totalCost)}</strong></div>
        <div class="mwi-construction-metric"><small data-role="construction-affordable-label">${escapeHtml(coverageLabel)}</small><strong data-role="construction-affordable">${coverageValue}</strong></div>
        <div class="mwi-construction-metric" data-role="construction-balance-metric" data-state="${hasBudget && remaining < 0 ? "danger" : "safe"}"><small data-role="construction-balance-label">${escapeHtml(remainingTitle)}</small><strong data-role="construction-balance">${remainingLabel}</strong></div>
        <output class="mwi-construction-budget-summary" data-role="construction-budget-summary">${escapeHtml(guildConstructionBudgetSummary(plan, definitions))}</output>
      </section>`;
    }

    function renderGuildBuildingTile(definition, plan, liveLevel, levelKnown, spriteBaseHref) {
      const currentLabel = formatNumber(liveLevel);
      const label = guildBuildingLabel(definition);
      const searchText =
        `${label} ${constructionCategoryLabel(definition.category)} ${definition.hrid}`.toLocaleLowerCase(ui().locale);
      const accessibleLabel = plan
        ? t("buildingTilePlannedLabel", { building: label, target: formatNumber(plan.targetLevel) })
        : !levelKnown
          ? t("buildingTileDefaultZeroLabel", { building: label })
          : t("buildingTileAddLabel", { building: label, current: formatNumber(liveLevel) });
      const atMaxLevel = !plan && liveLevel >= definition.maxLevel;
      const nextLevelCost = core.aggregateGuildBuildingLevelCosts(definition.levelCosts, liveLevel, liveLevel + 1);
      const costLabel =
        liveLevel >= definition.maxLevel
          ? t("buildingMaxLevel")
          : nextLevelCost.status === "ok"
            ? t("buildingCatalogNextLevelCost", {
                level: formatNumber(liveLevel + 1),
                points: formatNumber(nextLevelCost.totalCost)
              })
            : t("buildingCatalogNextLevelCostUnavailable");
      const costId = `mwi-building-next-cost-${definition.iconSymbolId}`;
      return `<button class="mwi-building-tile" data-role="building-tile" data-building-hrid="${escapeHtml(definition.hrid)}" data-category="${definition.category}" data-planned="${String(Boolean(plan))}" data-level-known="${String(levelKnown)}" data-current-level="${liveLevel}" data-building-search="${escapeHtml(searchText)}" aria-label="${escapeHtml(atMaxLevel ? t("buildingTileMaxLabel", { building: label }) : accessibleLabel)}" aria-describedby="${escapeHtml(costId)}" title="${escapeHtml(atMaxLevel ? t("buildingTileMaxLabel", { building: label }) : accessibleLabel)}" type="button"${atMaxLevel ? " disabled" : ""}>${guildBuildingIconMarkup(definition, spriteBaseHref)}<span class="mwi-building-tile-copy"><span class="mwi-building-tile-name">${escapeHtml(label)}</span><span class="mwi-building-tile-level">${escapeHtml(t(plan ? (levelKnown ? "buildingCatalogPlannedLevel" : "buildingCatalogUnknownPlannedLevel") : levelKnown ? "buildingCatalogCurrentLevel" : "buildingCatalogUnknownLevel", { current: currentLabel, target: plan ? formatNumber(plan.targetLevel) : "" }))}</span><span class="mwi-building-tile-cost" id="${escapeHtml(costId)}">${escapeHtml(costLabel)}</span></span></button>`;
    }

    function renderGuildBuildingPicker(definitions, levels, plansByHrid, spriteBaseHref) {
      const categories = ["all", "core", "life", "combat", "shrine"]
        .map(
          (category) =>
            `<button data-role="building-category" data-category="${category}" data-active="${String(category === state.buildingCategory)}" aria-pressed="${String(category === state.buildingCategory)}" type="button">${escapeHtml(constructionCategoryLabel(category))}</button>`
        )
        .join("");
      const tiles = buildingDataApi
        .sortCatalogDefinitions(definitions, state.guildBuildingDetails, state.guildShrineDetails)
        .map((definition) =>
          renderGuildBuildingTile(
            definition,
            plansByHrid.get(definition.hrid),
            levels.levels.get(definition.hrid),
            levels.knownHrids.has(definition.hrid),
            spriteBaseHref
          )
        )
        .join("");
      const unknownCount = Math.max(0, levels.totalCount - levels.knownCount);
      const status = t("buildingLevelsCoverage", {
        known: formatNumber(levels.knownCount),
        total: formatNumber(levels.totalCount)
      });
      return `<section class="mwi-building-picker" data-open="${String(constructionUi.pickerOpen)}"><button class="mwi-building-picker-toggle" data-role="toggle-building-picker" type="button" aria-expanded="${String(constructionUi.pickerOpen)}" aria-controls="mwi-building-picker-body"><span class="mwi-building-picker-plus" aria-hidden="true">${constructionIcon("add")}</span><span><strong>${escapeHtml(constructionUi.pickerOpen ? t("closeBuildingPicker") : t("addBuilding"))}</strong><small class="mwi-building-level-status" data-known-count="${levels.knownCount}" data-total-count="${levels.totalCount}" data-complete="${String(levels.knownCount === levels.totalCount)}">${escapeHtml(status)}</small></span><span class="mwi-building-picker-chevron" aria-hidden="true">${constructionIcon("chevron")}</span></button><div id="mwi-building-picker-body" class="mwi-building-picker-body"${constructionUi.pickerOpen ? "" : " hidden"}><div class="mwi-building-pane-heading"><span><h4>${escapeHtml(t("buildingCatalog"))}</h4>${unknownCount ? `<small>${escapeHtml(t("buildingLevelsPartialHint", { unknown: formatNumber(unknownCount) }))}</small>` : ""}</span><input data-role="building-search" type="search" placeholder="${escapeHtml(t("searchBuildings"))}" aria-label="${escapeHtml(t("searchBuildings"))}" value="${escapeHtml(state.buildingSearch)}"></div><div class="mwi-building-categories" role="group" aria-label="${escapeHtml(t("buildingCategoryFilter"))}">${categories}</div><div class="mwi-building-grid">${tiles}</div><div class="mwi-empty" data-role="building-filter-empty" role="status" aria-live="polite" aria-atomic="true" hidden></div></div></section>`;
    }

    function renderGuildConstructionActions(plan) {
      const disabled = plan.steps.length ? "" : " disabled";
      return `<div class="mwi-construction-actions"><button data-role="copy-building-plan" type="button"${disabled}>${escapeHtml(t("copyBuildingPlan"))}</button><button data-role="export-building-plan" type="button"${disabled}>${escapeHtml(t("exportBuildingCsv"))}</button><details class="mwi-construction-more"${plan.steps.length ? "" : " hidden"}><summary aria-label="${escapeHtml(t("moreConstructionActions"))}" title="${escapeHtml(t("moreConstructionActions"))}">${constructionIcon("more")}</summary><div><button class="mwi-clear-building-plans" data-role="clear-building-plans" type="button">${escapeHtml(t("clearBuildingPlans"))}</button></div></details></div>`;
    }

    function renderGuildConstructionQueue(plan, definitions, spriteBaseHref) {
      const byHrid = new Map(definitions.map((definition) => [definition.hrid, definition]));
      const groups = plan.plans.map((buildingPlan, planIndex) => {
        const definition = byHrid.get(buildingPlan.buildingHrid);
        const label = guildBuildingLabel(definition);
        const expanded = constructionUi.expandedBuildingHrids.has(buildingPlan.buildingHrid);
        const stepsId = `mwi-building-steps-${String(buildingPlan.buildingHrid)
          .split("/")
          .pop()
          .replace(/[^a-z0-9_-]/gi, "-")}`;
        const options = Array.from(
          { length: definition.maxLevel - buildingPlan.startLevel },
          (_, index) => buildingPlan.startLevel + index + 1
        )
          .map(
            (level) =>
              `<option value="${level}"${level === buildingPlan.targetLevel ? " selected" : ""}>${escapeHtml(t("level", { level: formatNumber(level) }))}</option>`
          )
          .join("");
        const cutoffInGroup = buildingPlan.steps.some((step) => step.globalIndex === plan.firstOverBudgetIndex);
        const cutoff = cutoffInGroup
          ? `<div class="mwi-budget-cutoff"><span>${escapeHtml(
              t("constructionGroupBudgetCutoff", {
                level: formatNumber(buildingPlan.affordableTargetLevel),
                count: formatNumber(buildingPlan.nextStepShortfall || 0)
              })
            )}</span></div>`
          : "";
        const budgetStateKey =
          {
            unbudgeted: "constructionBudgetUnbudgeted",
            within: "constructionWithinBudget",
            partial: "constructionPartiallyWithinBudget",
            outside: "constructionOverBudget"
          }[buildingPlan.budgetState] || "constructionBudgetUnbudgeted";
        const steps = buildingPlan.steps
          .map(
            (step) =>
              `<div class="mwi-construction-step" data-over-budget="${String(step.fitsBudget === false)}"><span class="mwi-construction-step-index">${formatNumber(step.globalIndex + 1)}</span><span class="mwi-construction-step-copy"><small>${formatNumber(step.fromLevel)} → ${formatNumber(step.toLevel)} · ${escapeHtml(step.fitsBudget === false ? t("constructionOverBudget") : t("constructionWithinBudget"))}</small></span><span class="mwi-construction-step-cost">${formatNumber(step.cost)}</span></div>`
          )
          .join("");
        return `<li class="mwi-construction-group" data-sort-key="${escapeHtml(buildingPlan.buildingHrid)}" data-building-hrid="${escapeHtml(buildingPlan.buildingHrid)}" data-budget-state="${buildingPlan.budgetState}" data-expanded="${String(expanded)}" aria-posinset="${planIndex + 1}" aria-setsize="${plan.plans.length}"><div class="mwi-construction-row"><button class="mwi-construction-drag-handle" data-role="construction-drag-handle" data-building-hrid="${escapeHtml(buildingPlan.buildingHrid)}" type="button" aria-label="${escapeHtml(t("dragConstructionPlan", { building: label }))}" title="${escapeHtml(t("dragConstructionPlan", { building: label }))}"><span aria-hidden="true"></span></button><span class="mwi-construction-building-icon">${guildBuildingIconMarkup(definition, spriteBaseHref)}</span><span class="mwi-construction-identity"><strong title="${escapeHtml(label)}">${escapeHtml(label)}</strong><small>${escapeHtml(t("constructionPlanRowMeta", { position: formatNumber(planIndex + 1), start: formatNumber(buildingPlan.startLevel), target: formatNumber(buildingPlan.targetLevel), count: formatNumber(buildingPlan.steps.length) }))}</small></span><span class="mwi-construction-cost"><small>${escapeHtml(t("buildingPlanCost"))}</small><strong>${formatNumber(buildingPlan.totalCost)}</strong><em>${escapeHtml(t(budgetStateKey))}</em></span><div class="mwi-construction-row-actions"><label class="mwi-construction-target"><span>${escapeHtml(t("targetLevel"))}</span><select data-role="building-target" data-building-hrid="${escapeHtml(buildingPlan.buildingHrid)}" aria-label="${escapeHtml(t("buildingTargetLabel", { building: label }))}">${options}</select></label><button class="mwi-construction-level-button" data-role="adjust-building-target" data-building-hrid="${escapeHtml(buildingPlan.buildingHrid)}" data-delta="1" type="button" aria-label="${escapeHtml(t("increaseBuildingTarget", { building: label, count: formatNumber(1) }))}" title="${escapeHtml(t("increaseBuildingTarget", { building: label, count: formatNumber(1) }))}"${buildingPlan.targetLevel >= definition.maxLevel ? " disabled" : ""}>+1</button><button class="mwi-construction-level-button" data-role="adjust-building-target" data-building-hrid="${escapeHtml(buildingPlan.buildingHrid)}" data-delta="5" type="button" aria-label="${escapeHtml(t("increaseBuildingTarget", { building: label, count: formatNumber(5) }))}" title="${escapeHtml(t("increaseBuildingTarget", { building: label, count: formatNumber(5) }))}"${buildingPlan.targetLevel >= definition.maxLevel ? " disabled" : ""}>+5</button><span class="mwi-construction-order-actions"><button class="mwi-icon-button mwi-icon-up" data-role="move-building-plan" data-building-hrid="${escapeHtml(buildingPlan.buildingHrid)}" data-direction="-1" type="button" aria-label="${escapeHtml(t("movePlanUp", { building: label }))}" title="${escapeHtml(t("movePlanUp", { building: label }))}"${planIndex <= 0 ? " disabled" : ""}>${constructionIcon("up")}</button><button class="mwi-icon-button mwi-icon-down" data-role="move-building-plan" data-building-hrid="${escapeHtml(buildingPlan.buildingHrid)}" data-direction="1" type="button" aria-label="${escapeHtml(t("movePlanDown", { building: label }))}" title="${escapeHtml(t("movePlanDown", { building: label }))}"${planIndex >= plan.plans.length - 1 ? " disabled" : ""}>${constructionIcon("down")}</button></span><button class="mwi-construction-expand" data-role="toggle-building-steps" data-building-hrid="${escapeHtml(buildingPlan.buildingHrid)}" type="button" aria-expanded="${String(expanded)}" aria-controls="${stepsId}" aria-label="${escapeHtml(t(expanded ? "collapseBuildingSteps" : "expandBuildingSteps", { building: label }))}" title="${escapeHtml(t(expanded ? "collapseBuildingSteps" : "expandBuildingSteps", { building: label }))}">${constructionIcon("chevron")}</button><button class="mwi-construction-remove" data-role="remove-building-plan" data-building-hrid="${escapeHtml(buildingPlan.buildingHrid)}" type="button" aria-label="${escapeHtml(t("removeBuildingFromPlan", { building: label }))}" title="${escapeHtml(t("removeBuildingFromPlan", { building: label }))}">${constructionIcon("close")}</button></div></div>${cutoff}<div id="${stepsId}" class="mwi-construction-group-steps"${expanded ? "" : " hidden"}>${steps}</div></li>`;
      });
      return `<section class="mwi-construction-queue" aria-label="${escapeHtml(t("constructionQueue"))}"><div class="mwi-construction-queue-heading"><span><h4>${escapeHtml(t("constructionQueue"))}</h4></span><span class="mwi-construction-queue-meta"><small>${escapeHtml(t("constructionSummary", { buildings: formatNumber(plan.plans.length), steps: formatNumber(plan.steps.length) }))}</small>${renderGuildConstructionActions(plan)}</span></div>${groups.length ? `<ol class="mwi-construction-rail" data-role="construction-sort-list">${groups.join("")}</ol>` : `<div class="mwi-construction-empty"><strong>${escapeHtml(t("constructionQueueEmptyTitle"))}</strong></div>`}</section>`;
    }

    function renderGuildPointPlanning(plan, definitions, historySummary) {
      const currentPoints = state.guildPointSummary ? formatNumber(state.guildPointSummary.availablePoints) : "-";
      return `<section class="mwi-guild-point-planning" aria-label="${escapeHtml(t("guildPointPlanningHeading"))}"><div class="mwi-construction-planning-heading"><h4>${escapeHtml(t("guildPointPlanningHeading"))}</h4><span><small>${escapeHtml(t("currentAvailableGuildPoints"))}</small><strong data-role="current-available-guild-points">${currentPoints}</strong></span></div><div class="mwi-construction-planning-body">${renderGuildPointForecastControls(plan)}<div class="mwi-construction-outcome">${renderGuildBuildingBudget(plan, definitions)}${renderGuildPointEta(plan, historySummary)}</div></div></section>`;
    }

    function renderGuildConstruction(plan, definitions, historySummary) {
      const plansByHrid = new Map(state.buildingPlans.map((entry) => [entry.buildingHrid, entry]));
      const levels = guildBuildingLevelSnapshot(definitions);
      const spriteBaseHref = guildBuildingSpriteBaseHref();
      const budget = renderGuildPointPlanning(plan, definitions, historySummary);
      return `<!-- THESIS: Compact construction workspace with a continuous queue.
OWN-WORLD: Game-native indigo, quiet dividers, mint actions, aligned tabular numbers.
STORY: Check budget, edit the ordered plan, inspect weekly evidence.
FIRST VIEWPORT: Compact budget above queue; searchable catalog alongside at wide widths.
FORM: Compact ledger workbench, candidate 5, seed 1c5344fd; user brief pins simplicity.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md -->${budget}<div class="mwi-construction-layout" data-picker-open="${String(constructionUi.pickerOpen)}"><div class="mwi-construction-queue-pane">${renderGuildConstructionQueue(plan, definitions, spriteBaseHref)}</div>${renderGuildBuildingPicker(definitions, levels, plansByHrid, spriteBaseHref)}</div>${renderGuildPointForecast(historySummary)}`;
    }

    function applyGuildBuildingFilters(results) {
      if (!results) return 0;
      const normalizedSearch = state.buildingSearch.trim().toLocaleLowerCase(ui().locale);
      let visibleCount = 0;
      for (const tile of results.querySelectorAll(".mwi-building-tile")) {
        const matchesCategory = state.buildingCategory === "all" || tile.dataset.category === state.buildingCategory;
        const matchesSearch = !normalizedSearch || String(tile.dataset.buildingSearch || "").includes(normalizedSearch);
        tile.hidden = !(matchesCategory && matchesSearch);
        if (!tile.hidden) visibleCount += 1;
      }
      for (const button of results.querySelectorAll('[data-role="building-category"]')) {
        const active = button.dataset.category === state.buildingCategory;
        button.dataset.active = String(active);
        button.setAttribute("aria-pressed", String(active));
      }
      const empty = results.querySelector('[data-role="building-filter-empty"]');
      if (empty) {
        empty.textContent = visibleCount === 0 ? t("noBuildingMatches") : "";
        empty.hidden = visibleCount !== 0;
      }
      return visibleCount;
    }

    function refreshGuildConstructionBudgetPreview(panel) {
      const results = panel && panel.querySelector('[data-role="construction-results"]');
      if (!results) return;
      const definitions = guildBuildingDefinitions();
      const historySummary = guildPointHistorySummary();
      const plan = guildBuildingPlan(definitions, historySummary);
      const budget = results.querySelector(".mwi-construction-budget");
      if (budget) {
        const hasBudget = plan.availableGuildPoints !== null;
        const remaining = plan.remainingGuildPoints;
        budget.dataset.overBudget = String(Boolean(plan.overBudget));
        const spend = budget.querySelector('[data-role="construction-planned-spend"]');
        const affordableLabel = budget.querySelector('[data-role="construction-affordable-label"]');
        const affordable = budget.querySelector('[data-role="construction-affordable"]');
        const balanceLabel = budget.querySelector('[data-role="construction-balance-label"]');
        const balance = budget.querySelector('[data-role="construction-balance"]');
        const balanceMetric = budget.querySelector('[data-role="construction-balance-metric"]');
        const summary = budget.querySelector('[data-role="construction-budget-summary"]');
        if (spend) spend.textContent = formatNumber(plan.totalCost);
        if (affordableLabel) affordableLabel.textContent = hasBudget ? t("affordableUpgrades") : t("plannedUpgrades");
        if (affordable)
          affordable.textContent = hasBudget
            ? `${formatNumber(plan.affordableStepCount)} / ${formatNumber(plan.steps.length)}`
            : formatNumber(plan.steps.length);
        if (balanceLabel)
          balanceLabel.textContent = hasBudget && remaining < 0 ? t("overBudgetBy") : t("remainingPoints");
        if (balance) balance.textContent = hasBudget ? formatNumber(Math.abs(remaining)) : "-";
        if (balanceMetric) balanceMetric.dataset.state = hasBudget && remaining < 0 ? "danger" : "safe";
        if (summary) summary.textContent = guildConstructionBudgetSummary(plan, definitions);
      }
      const queuePane = results.querySelector(".mwi-construction-queue-pane");
      if (queuePane)
        queuePane.innerHTML = renderGuildConstructionQueue(plan, definitions, guildBuildingSpriteBaseHref());
      const eta = results.querySelector(".mwi-guild-point-eta");
      if (eta) eta.outerHTML = renderGuildPointEta(plan, historySummary);
      const planningSummary = results.querySelector('[data-role="guild-point-planning-summary"]');
      if (planningSummary) {
        planningSummary.textContent = guildPointPlanningSummary(plan.planning);
        planningSummary.dataset.state =
          plan.planning.basePoints === null || (plan.planning.weeks > 0 && !plan.planning.canProject)
            ? "warning"
            : "ready";
      }
    }

    function refreshGuildConstruction(panel) {
      hydrateBridgeData();
      extractItemDetailsFromReact();
      hydrateLocalInitData();
      const definitions = guildBuildingDefinitions();
      const historySummary = syncGuildPointHistory();
      const plan = guildBuildingPlan(definitions, historySummary);
      const status = panel.querySelector('[data-role="construction-status"]');
      const results = panel.querySelector('[data-role="construction-results"]');
      const statusText = status && status.querySelector('[data-role="construction-status-text"]');
      const undoButton = status && status.querySelector('[data-role="undo-clear-building-plans"]');
      if (statusText) statusText.textContent = state.buildingPlanNotice || "";
      else if (status) status.textContent = state.buildingPlanNotice || "";
      if (undoButton) undoButton.hidden = !hasGuildBuildingClearUndo();
      if (status) status.hidden = !state.buildingPlanNotice && !hasGuildBuildingClearUndo();
      updateRenderedMarkup(results, renderGuildConstruction(plan, definitions, historySummary));
      applyGuildBuildingFilters(results);
    }

    function guildConstructionText(plan, definitions) {
      const byHrid = new Map(definitions.map((definition) => [definition.hrid, definition]));
      const budget = plan.availableGuildPoints === null ? "-" : formatNumber(plan.availableGuildPoints);
      const remaining = plan.remainingGuildPoints === null ? "-" : formatNumber(plan.remainingGuildPoints);
      return [
        t("guildConstruction"),
        `${t("guildPointBudget")}: ${budget}`,
        `${t("plannedSpend")}: ${formatNumber(plan.totalCost)}`,
        `${t("remainingPoints")}: ${remaining}`,
        "",
        ...plan.steps.map(
          (step, index) =>
            `${formatNumber(index + 1)}. ${guildBuildingLabel(byHrid.get(step.buildingHrid))} ${formatNumber(step.fromLevel)} → ${formatNumber(step.toLevel)} · ${formatNumber(step.cost)}`
        )
      ].join("\n");
    }

    async function copyGuildConstructionPlan(panel) {
      const definitions = guildBuildingDefinitions();
      const plan = guildBuildingPlan(definitions);
      const text = guildConstructionText(plan, definitions);
      try {
        if (
          !pageWindow.navigator ||
          !pageWindow.navigator.clipboard ||
          typeof pageWindow.navigator.clipboard.writeText !== "function"
        )
          throw new Error("clipboard unavailable");
        await pageWindow.navigator.clipboard.writeText(text);
        state.buildingPlanNotice = t("buildingPlanCopied");
      } catch (_) {
        state.buildingPlanNotice = t("buildingPlanCopyFailed");
      }
      refreshGuildConstruction(panel);
    }

    function exportGuildConstructionCsv() {
      const definitions = guildBuildingDefinitions();
      const plan = guildBuildingPlan(definitions);
      const byHrid = new Map(definitions.map((definition) => [definition.hrid, definition]));
      const escapeCsv = (value) => `"${String(value).replaceAll('"', '""')}"`;
      const rows = [
        [
          t("constructionOrder"),
          t("guildConstruction"),
          "HRID",
          t("fromLevel"),
          t("toLevel"),
          t("stepCost"),
          t("cumulativeCost"),
          t("constructionWithinBudget")
        ]
      ];
      for (let index = 0; index < plan.steps.length; index += 1) {
        const step = plan.steps[index];
        rows.push([
          index + 1,
          guildBuildingLabel(byHrid.get(step.buildingHrid)),
          step.buildingHrid,
          step.fromLevel,
          step.toLevel,
          step.cost,
          step.cumulativeCost,
          step.fitsBudget === false ? t("constructionOverBudget") : t("constructionWithinBudget")
        ]);
      }
      const csv = `\uFEFF${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}`;
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = t("buildingCsvFileName");
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      pageWindow.setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    function guildPointHistoryCsv() {
      const history = guildPointHistorySummary();
      const escapeCsv = (value) => `"${String(value).replaceAll('"', '""')}"`;
      const rows = [[t("guildPointCsvWeekStart"), t("guildPointCsvEarned"), t("guildPointCsvStatus")]];
      const exported = new Map(history.trackedWeeks.map((record) => [record.weekStartAt, record]));
      for (const raw of state.guildPointHistory?.weeks || []) {
        if (!exported.has(raw.weekStartAt)) exported.set(raw.weekStartAt, raw);
      }
      for (const entry of [...exported.values()].sort((left, right) => left.weekStartAt - right.weekStartAt)) {
        const raw = (state.guildPointHistory?.weeks || []).find((record) => record.weekStartAt === entry.weekStartAt);
        const partial =
          raw &&
          raw.weekStartAt < history.currentWeekStartAt &&
          raw.coverage !== "verified" &&
          entry.source !== "manual";
        const record = partial ? raw : entry;
        rows.push([
          new Date(record.weekStartAt).toISOString(),
          record.earnedPoints,
          t(
            partial
              ? "guildPointCsvPartial"
              : record.complete
                ? record.source === "manual"
                  ? "guildPointCsvManual"
                  : record.source === "estimated"
                    ? "guildPointCsvEstimated"
                    : "guildPointCsvComplete"
                : "guildPointCsvTracking"
          )
        ]);
      }
      return `\uFEFF${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}`;
    }

    function exportGuildPointHistoryCsv() {
      const history = guildPointHistorySummary();
      if (!history.trackedWeeks.length) return false;
      const url = URL.createObjectURL(new Blob([guildPointHistoryCsv()], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = t("guildPointCsvFileName");
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      pageWindow.setTimeout(() => URL.revokeObjectURL(url), 0);
      return true;
    }

    function saveManualGuildPointWeek(weekStartAt, earnedPoints) {
      const result = core.setManualGuildPointWeek(
        state.guildPointHistory,
        weekStartAt,
        earnedPoints,
        Date.now(),
        guildTrialFirstStartAt
      );
      state.buildingPlanNotice = t(
        result.status === "saved"
          ? "manualGuildPointWeekSaved"
          : result.status === "tracked"
            ? "manualGuildPointWeekTracked"
            : "manualGuildPointWeekInvalid"
      );
      if (result.status !== "saved") return result;
      state.guildPointHistory = result.history;
      persistGuildBuildingPlannerState();
      return result;
    }

    function saveManualGuildPointHistory(entries) {
      const originalHistory = state.guildPointHistory;
      let nextHistory = originalHistory;
      for (const entry of Array.isArray(entries) ? entries : []) {
        const weekStartAt = Number(entry && entry.weekStartAt);
        const rawPoints = String((entry && entry.earnedPoints) ?? "").trim();
        const trackedRecord = (originalHistory?.weeks || []).find(
          (record) => record.complete && record.weekStartAt === weekStartAt
        );
        const existingManualRecord = (originalHistory?.manualWeeks || []).find(
          (record) => record.weekStartAt === weekStartAt
        );
        if (rawPoints === "") {
          nextHistory = core.removeManualGuildPointWeek(nextHistory, weekStartAt, {
            discardZeroTracked:
              Boolean(existingManualRecord) || constructionUi.trackedGuildPointEditWeekStarts.has(weekStartAt)
          }).history;
          continue;
        }
        if (
          trackedRecord &&
          !existingManualRecord &&
          Number(rawPoints) === trackedRecord.earnedPoints &&
          !constructionUi.trackedGuildPointEditWeekStarts.has(weekStartAt)
        )
          continue;
        const result = core.setManualGuildPointWeek(
          nextHistory,
          weekStartAt,
          Number(rawPoints),
          Date.now(),
          guildTrialFirstStartAt,
          {
            allowTrackedOverride:
              Boolean(existingManualRecord) || constructionUi.trackedGuildPointEditWeekStarts.has(weekStartAt)
          }
        );
        if (result.status !== "saved") {
          state.buildingPlanNotice = t(
            result.status === "tracked" ? "manualGuildPointWeekTracked" : "manualGuildPointWeekInvalid"
          );
          return { ...result, weekStartAt };
        }
        nextHistory = result.history;
      }
      constructionUi.trackedGuildPointEditWeekStarts.clear();
      state.guildPointHistory = nextHistory;
      state.buildingPlanNotice = t("manualGuildPointHistorySaved");
      persistGuildBuildingPlannerState();
      return { status: "saved", history: nextHistory };
    }

    function removeManualGuildPointWeek(weekStartAt) {
      const result = core.removeManualGuildPointWeek(state.guildPointHistory, weekStartAt);
      if (!result.changed) return false;
      state.guildPointHistory = result.history;
      state.buildingPlanNotice = t("manualGuildPointWeekRemoved");
      persistGuildBuildingPlannerState();
      return true;
    }

    function resetGuildPointHistory(panel) {
      if (typeof pageWindow.confirm !== "function" || !pageWindow.confirm(t("resetGuildPointHistoryConfirm")))
        return false;
      state.guildPointHistory = { guildId: "", lastObservation: null, weeks: [] };
      if (state.guildPointSummary) syncGuildPointHistory();
      else persistGuildBuildingPlannerState();
      state.buildingPlanNotice = t("guildPointHistoryReset");
      if (panel) refreshGuildConstruction(panel);
      return true;
    }

    function dispose() {
      discardGuildBuildingClearUndo();
    }

    return {
      guildBuildingDefinitions,
      currentGuildBuildingLevel,
      addGuildBuildingPlan,
      setGuildBuildingTarget,
      removeGuildBuildingPlan,
      moveGuildBuildingPlan,
      reorderGuildBuildingPlan,
      setGuildBuildingPickerOpen,
      setGuildPointHistoryOpen,
      openTrackedGuildPointEditWarning,
      cancelTrackedGuildPointEditWarning,
      confirmTrackedGuildPointEditWarning,
      toggleGuildBuildingSteps,
      clearGuildBuildingPlans,
      undoClearGuildBuildingPlans,
      hasGuildBuildingClearUndo,
      applyGuildBuildingFilters,
      guildPointHistorySummary,
      guildPointPlanningBudget,
      guildPointEta,
      renderGuildPointForecast,
      renderGuildPointPlanning,
      syncGuildPointHistory,
      refreshGuildConstructionBudgetPreview,
      refreshGuildConstruction,
      copyGuildConstructionPlan,
      exportGuildConstructionCsv,
      guildPointHistoryCsv,
      exportGuildPointHistoryCsv,
      saveManualGuildPointWeek,
      saveManualGuildPointHistory,
      removeManualGuildPointWeek,
      resetGuildPointHistory,
      dispose
    };
  }

  return { createConstructionView };
});


// SOURCE: src/ui/trial-player-view.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildTrialPlayerView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const SKILL_ROWS = [
    ["milking", "foraging", "woodcutting", "cheesesmithing", "crafting"],
    ["tailoring", "cooking", "brewing", "alchemy", "enhancing"],
    ["stamina", "intelligence", "attack", "defense"],
    ["melee", "ranged", "magic"]
  ];
  // Official house room HRIDs, in the same skill order as the native profile.
  const SKILL_ROOMS = {
    milking: "dairy_barn",
    foraging: "garden",
    woodcutting: "log_shed",
    cheesesmithing: "forge",
    crafting: "workshop",
    tailoring: "sewing_parlor",
    cooking: "kitchen",
    brewing: "brewery",
    alchemy: "laboratory",
    enhancing: "observatory",
    stamina: "dining_room",
    intelligence: "library",
    attack: "dojo",
    defense: "armory",
    melee: "gym",
    ranged: "archery_range",
    magic: "mystical_study"
  };
  function skillHouseLevel(roomMap, skillKey) {
    const room = SKILL_ROOMS[skillKey];
    if (!room || !roomMap || typeof roomMap !== "object" || Array.isArray(roomMap)) return null;
    const hrid = `/house_rooms/${room}`;
    if (!Object.hasOwn(roomMap, hrid)) return null;
    const level = roomMap[hrid]?.level;
    return Number.isSafeInteger(level) && level >= 0 ? level : null;
  }

  function skillLayout(skills) {
    const slots = SKILL_ROWS.flatMap((keys, row) =>
      keys.map((key, column) => ({
        key,
        row: row + 1,
        column: column + 1,
        skill: null
      }))
    );
    let extra = 0;
    for (const skill of skills) {
      if (!skill?.skillHrid) continue;
      const key = String(skill.skillHrid).split("/").pop();
      if (key === "total_level") continue;
      const slot = slots.find((slot) => slot.key === key && !slot.skill);
      if (slot) slot.skill = skill;
      else {
        slots.push({ key, row: 5 + Math.floor(extra / 5), column: (extra % 5) + 1, skill });
        extra += 1;
      }
    }
    return slots;
  }
  // Positions mirror the game's EquipmentLocationToSlotMap (rows 5–6 separate tools).
  const EQUIPMENT_SLOTS = [
    ["back", 1, 1],
    ["head", 1, 2],
    ["trinket", 1, 3],
    ["neck", 1, 5],
    ["main_hand", 2, 1],
    ["body", 2, 2],
    ["off_hand", 2, 3],
    ["earrings", 2, 5],
    ["hands", 3, 1],
    ["legs", 3, 2],
    ["pouch", 3, 3],
    ["ring", 3, 5],
    ["feet", 4, 2],
    ["charm", 4, 5],
    ["milking_tool", 7, 1],
    ["foraging_tool", 7, 2],
    ["woodcutting_tool", 7, 3],
    ["cheesesmithing_tool", 7, 4],
    ["crafting_tool", 7, 5],
    ["tailoring_tool", 8, 1],
    ["cooking_tool", 8, 2],
    ["brewing_tool", 8, 3],
    ["alchemy_tool", 8, 4],
    ["enhancing_tool", 8, 5]
  ];
  function equipmentLayout(wearableItemMap, itemDetails = {}) {
    const slots = EQUIPMENT_SLOTS.map(([key, row, column]) => ({ key, row, column, item: null }));
    const extras = [];
    for (const [key, item] of Object.entries(wearableItemMap || {})) {
      if (!item?.itemHrid) continue;
      const location =
        item.itemLocationHrid ||
        (key.startsWith("/item_locations/") ? key : null) ||
        itemDetails[item.itemHrid]?.equipmentDetail?.type ||
        key;
      let slotKey = String(location).split("/").pop();
      if (slotKey === "two_hand") slotKey = "main_hand";
      const slot = slots.find((slot) => slot.key === slotKey);
      if (slot && !slot.item) slot.item = item;
      else extras.push(item);
    }
    return { slots, extras };
  }

  function createMemberNameFormatter({ t, isScreenshotMode }) {
    const aliases = new Map();
    return (member) => {
      if (!isScreenshotMode()) return member.name || t("trialNameUnavailable");
      if (member.id == null && !member.name) return t("trialNameUnavailable");
      const key = JSON.stringify([member.id == null ? "name" : "id", member.id ?? member.name]);
      if (!aliases.has(key)) aliases.set(key, aliases.size + 1);
      return t("trialAnonymousPlayer", { number: aliases.get(key) });
    };
  }

  // Resolve CSS-module hashes from the loaded game stylesheet, so custom
  // gradients, shadows and pseudo-elements keep the game's own implementation.
  function nativeNameClasses(document) {
    const classes = new Map();
    const visit = (rules) => {
      for (const rule of rules || []) {
        for (const match of (rule.selectorText || "").matchAll(/\.(CharacterName_([A-Za-z0-9_]+?)__[A-Za-z0-9_-]+)/g))
          classes.set(match[2], match[1]);
        if (rule.cssRules) visit(rule.cssRules);
      }
    };
    for (const sheet of document.styleSheets || []) {
      try {
        visit(sheet.cssRules);
      } catch (_) {
        // Cross-origin stylesheets may be unreadable; names remain usable.
      }
    }
    return classes;
  }

  function createMemberNameRenderer({ escapeHtml: e, formatMemberName, isPlain, gameIcon, document }) {
    let classes = new Map();
    let cosmetics = new Map();
    const validHrid = (value, type) => typeof value === "string" && new RegExp(`^/${type}/[a-z0-9_]+$`).test(value);
    const render = (member, saved) => {
      const name = formatMemberName(member);
      if (isPlain()) return `<span class="mwi-trial-member-name">${e(name)}</span>`;
      const appearance = member.id == null ? saved : cosmetics.get(String(member.id)) || saved;
      const icons = [appearance?.specialChatIconHrid, appearance?.chatIconHrid]
        .filter((hrid) => validHrid(hrid, "chat_icons"))
        .map((hrid) => gameIcon("chat_icons_sprite", hrid.split("/").pop(), "mwi-trial-name-icon"))
        .join("");
      const color = validHrid(appearance?.nameColorHrid, "name_colors")
        ? classes.get(appearance.nameColorHrid.split("/").pop())
        : null;
      const native = color && classes.get("characterName") && classes.get("name");
      return `<span class="mwi-trial-member-name${native ? ` ${e(classes.get("characterName"))}` : ""}" translate="no">${icons}<span class="mwi-trial-name-text${native ? ` ${e(classes.get("name"))} ${e(color)}` : ""}"${native ? ` data-name="${e(name)}"` : ""}><span>${e(name)}</span></span></span>`;
    };
    render.refresh = (records, context = {}) => {
      classes = nativeNameClasses(document);
      cosmetics = new Map();
      // Most recently observed appearance wins; never match separate identities by name.
      for (const record of [...records].sort((a, b) => (a.capturedAt || 0) - (b.capturedAt || 0))) {
        for (const row of record.rows) {
          if (row.characterId == null) continue;
          const saved = record.members?.[row.memberKey ?? row.characterId];
          if (saved) cosmetics.set(String(row.characterId), saved);
        }
      }
      for (const [id, member] of Object.entries(context.members || {}))
        cosmetics.set(id, { ...cosmetics.get(id), ...member });
    };
    return render;
  }

  function createRenderer({
    t,
    escapeHtml: e,
    trialHistoryApi: api,
    trialName,
    weekLabel,
    projectIcon,
    profileIcon,
    getBridge,
    resolveItemName,
    renderRecord,
    renderRail,
    memberIdentityAttributes,
    formatMemberName,
    renderMemberName = (member) => e(formatMemberName(member)),
    isScreenshotMode
  }) {
    const tooltipRecords = new Map();
    function tooltipAttribute(kind, record) {
      if (!record || isScreenshotMode()) return "";
      const key = String(tooltipRecords.size);
      tooltipRecords.set(key, { kind, record });
      return `data-trial-profile-tooltip="${key}"`;
    }
    const number = (value, digits) =>
      typeof value === "number" && Number.isFinite(value)
        ? digits === undefined
          ? String(value)
          : value.toFixed(digits)
        : "—";
    const entries = (value) => (Array.isArray(value) ? value : Object.values(value || {}));
    const suffix = (value) =>
      String(value || "")
        .split("/")
        .pop();
    const label = (hrid) => {
      const key = suffix(hrid);
      const translated = t(`trialName_${key}`);
      if (translated !== `trialName_${key}`) return translated;
      const skill = t(`trialSkill_${key}`);
      return skill !== `trialSkill_${key}` ? skill : key;
    };
    const metric = (name, value, icon = "") => `<div><dt>${icon}<span>${e(name)}</span></dt><dd>${e(value)}</dd></div>`;
    function equipmentTile(item, attributes = "") {
      const name = resolveItemName(
        item.itemHrid,
        getBridge()?.itemDetails?.[item.itemHrid]?.name || suffix(item.itemHrid)
      );
      const level = item.enhancementLevel > 0 ? `+${item.enhancementLevel}` : "";
      const description = `${name}${level ? ` ${level}` : ""}`;
      const icon = profileIcon("item", item.itemHrid);
      const tier = item.enhancementLevel >= 11 ? "gold" : item.enhancementLevel >= 8 ? "purple" : "blue";
      return `<div class="mwi-trial-equipment-slot" ${attributes} ${tooltipAttribute("item", item)} tabindex="0" role="img" aria-label="${e(description)}" title="${e(description)}">${icon || `<span class="mwi-trial-slot-label">${e(name)}</span>`}${level ? `<span class="mwi-trial-equipment-level" data-tier="${tier}">${e(level)}</span>` : ""}</div>`;
    }
    function equipmentMarkup(profile) {
      if (!profile.wearableItemMap) return "";
      const { slots, extras } = equipmentLayout(profile.wearableItemMap, getBridge()?.itemDetails);
      let html = `<div class="mwi-trial-equipment-grid">${slots
        .map(({ key, row, column, item }) => {
          const attributes = `data-equipment-slot="${key}" style="grid-row:${row};grid-column:${column}"`;
          return item
            ? equipmentTile(item, attributes)
            : `<div class="mwi-trial-equipment-slot mwi-trial-equipment-empty" ${attributes}><span>${e(t(`trialSlot_${key}`))}</span></div>`;
        })
        .join("")}</div>`;
      if (extras.length)
        html += `<div class="mwi-trial-equipment-extra">${extras.map((item) => equipmentTile(item)).join("")}</div>`;
      return html;
    }
    function abilitiesMarkup(profile) {
      const abilities = entries(profile.equippedAbilities)
        .filter((item) => item?.abilityHrid)
        .sort((a, b) => (a.slotNumber ?? 0) - (b.slotNumber ?? 0));
      if (!abilities.length) return "";
      return `<div class="mwi-trial-profile-abilities" aria-label="${e(t("trialProfileAbilities"))}">${abilities
        .map((item) => {
          const name = label(item.abilityHrid),
            level = `Lv.${number(item.level)}`;
          return `<div class="mwi-trial-equipment-slot mwi-trial-ability-slot" ${tooltipAttribute("ability", item)} tabindex="0" role="img" aria-label="${e(`${name} ${level}`)}" title="${e(`${name} ${level}`)}">${profileIcon("ability", item.abilityHrid) || `<span class="mwi-trial-slot-label">${e(name)}</span>`}<span class="mwi-trial-equipment-level">${e(level)}</span></div>`;
        })
        .join("")}</div>`;
    }
    function skillsMarkup(skills, roomMap) {
      if (!skills.some((skill) => suffix(skill.skillHrid) !== "total_level")) return "";
      return `<div class="mwi-trial-skill-grid" aria-label="${e(t("trialProfileSkills"))}">${skillLayout(skills)
        .map(({ key, row, column, skill }) => {
          const hrid = skill?.skillHrid || `/skills/${key}`;
          const name = label(hrid);
          const level = `Lv.${number(skill?.level)}`;
          const houseLevel = skillHouseLevel(roomMap, key);
          const houseLabel = t("trialProfileHouseLevel", { level: number(houseLevel) });
          const description = `${name} ${level} · ${houseLabel}`;
          const houseBadge = `<span class="mwi-trial-skill-house" data-house-level="${e(number(houseLevel))}"${houseLevel === null ? ' data-unknown="true"' : ""} aria-hidden="true"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m1.5 7 6.5-5.5L14.5 7M3.5 5.5v8h9v-8M6.5 13.5v-5h3v5"/></svg><span>${e(number(houseLevel))}</span></span>`;
          return `<div class="mwi-trial-equipment-slot mwi-trial-skill-slot" data-profile-skill="${e(key)}" ${tooltipAttribute("skill", skill)} style="grid-row:${row};grid-column:${column}" tabindex="0" role="img" aria-label="${e(description)}" title="${e(description)}">${profileIcon("skill", hrid) || `<span class="mwi-trial-slot-label">${e(name)}</span>`}<span class="mwi-trial-equipment-level">${e(level)}</span>${houseBadge}</div>`;
        })
        .join("")}</div>`;
    }
    function profileSection(key, title, content, sectionOpen) {
      if (!content) return "";
      return `<details class="mwi-trial-profile-section" data-trial-profile-section="${key}" ${sectionOpen[key] !== false ? "open" : ""}><summary>${e(t(title))}</summary>${content}</details>`;
    }
    function overviewMarkup(projects, sectionOpen) {
      const multiple = (value) => (value === null ? "—" : `${value.toFixed(2)}×`);
      const cells = (values) =>
        `<td data-trial-overview-count>${values.participations}</td><td data-trial-overview-average>${multiple(values.average)}</td><td data-trial-overview-total>${multiple(values.total)}</td>`;
      const tables = ["skilling", "combat"]
        .map((kind) => {
          const categoryProjects = projects.filter((project) => project.kind === kind);
          const rows = categoryProjects
            .map(
              (project) =>
                `<tr data-trial-overview-project="${e(project.trialHrid)}"><th scope="row"><span>${projectIcon(project)}<span class="mwi-trial-overview-project-name">${e(trialName(project))}</span></span></th>${cells(project)}</tr>`
            )
            .join("");
          const summary = api.summarizePlayerProjects(categoryProjects);
          return `<table class="mwi-trial-player-overview" data-trial-overview-kind="${kind}"><caption>${e(t(kind === "skilling" ? "trialSkilling" : "trialCombat"))}</caption><colgroup><col class="mwi-trial-overview-name"><col class="mwi-trial-overview-count"><col><col></colgroup><thead><tr><th scope="col">${e(t("trialOverviewProject"))}</th><th scope="col">${e(t("trialRankingCount"))}</th><th scope="col">${e(t("trialOverviewAverage"))}</th><th scope="col">${e(t("trialOverviewTotal"))}</th></tr></thead><tbody>${rows}</tbody><tfoot><tr data-trial-overview-summary="${kind}"><th scope="row">${e(t("trialOverviewAllProjects"))}</th>${cells(summary)}</tr></tfoot></table>`;
        })
        .join("");
      return profileSection("overview", "trialPlayerOverview", tables, sectionOpen);
    }
    function joiningTime(value) {
      if (value === null) return e(t("trialProfileJoinedAtUnknown"));
      const date = new Date(value);
      const pad = (number) => String(number).padStart(2, "0");
      const local = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
      return `<time datetime="${e(date.toISOString())}">${e(local)}</time>`;
    }
    function joinedAtMarkup(member) {
      return `<div data-trial-profile-joined-at><dt><span>${e(t("trialProfileJoinedAt"))}</span></dt><dd>${joiningTime(api.currentMemberJoinedAt(getBridge()?.trialHistoryContext, member))}</dd></div>`;
    }
    function activityMarkup(profile) {
      const character = profile?.sharableCharacter;
      const action =
        typeof character?.actionType === "string" && /^\/action_types\/([a-z_]+)$/.exec(character.actionType)?.[1];
      const activity = SKILL_ROWS.slice(0, 2).flat().includes(action)
        ? t(`trialName_${action}`)
        : ["combat", "labyrinth", "special"].includes(action)
          ? t(`trialActivity_${action}`)
          : t("trialActivityUnknown");
      const presence =
        character?.hideOnlineStatus === true
          ? "hidden"
          : character?.isOnline === true
            ? "online"
            : character?.isOnline === false
              ? "offline"
              : "unknown";
      return `<div data-trial-profile-activity><dt><span>${e(t("trialProfileActivity"))}</span></dt><dd>${e(activity)}</dd></div><div data-trial-profile-presence="${presence}"><dt><span>${e(t("trialProfilePresence"))}</span></dt><dd>${e(t(`trialPresence_${presence}`))}</dd></div>`;
    }

    function profileMarkup(state, sectionOpen, projects, member) {
      const overview = overviewMarkup(projects, sectionOpen);
      const joinedAt = joinedAtMarkup(member);
      if (state.status !== "ready")
        return `<p class="mwi-trial-meta" role="status">${e(t(state.status === "loading" ? "trialProfileLoading" : state.status === "timeout" ? "trialProfileTimeout" : state.status === "mismatch" ? "trialProfileMismatch" : "trialProfileUnavailable"))}</p><dl class="mwi-trial-profile-facts">${activityMarkup(null)}${joinedAt}</dl>${overview}`;
      const profile = state.profile;
      const skills = entries(profile.characterSkills).filter((item) => item && item.skillHrid);
      const total = skills.find((item) => suffix(item.skillHrid) === "total_level");
      let html = `<dl class="mwi-trial-profile-facts">${activityMarkup(profile)}${metric(t("trialProfileTotalLevel"), number(total?.level ?? profile.totalLevel))}${metric(t("trialProfileCombatLevel"), number(profile.combatLevel, 1))}${joinedAt}</dl>`;
      html += overview;
      html += profileSection(
        "skills",
        "trialProfileSkills",
        skillsMarkup(skills, profile.characterHouseRoomMap),
        sectionOpen
      );
      html += profileSection(
        "equipment",
        "trialProfileEquipment",
        equipmentMarkup(profile) + abilitiesMarkup(profile),
        sectionOpen
      );
      for (const [field, heading, hrid] of [["characterHouseRoomMap", "trialProfileHouse", "roomHrid"]]) {
        const values = entries(profile[field]).filter((item) => item?.[hrid]);
        if (values.length)
          html += `<h4>${e(t(heading))}</h4><dl class="mwi-trial-profile-facts">${values.map((item) => metric(label(item[hrid]), number(item.level))).join("")}</dl>`;
      }
      if (!isScreenshotMode())
        html += `<details class="mwi-trial-raw"><summary>${e(t("trialProfileRaw"))}</summary><pre>${e(JSON.stringify(profile, null, 2))}</pre></details>`;
      return html;
    }
    function historyMarkup(weeks) {
      if (!weeks.length) return `<p class="mwi-trial-meta">${e(t("trialPlayerEmpty"))}</p>`;
      return ["skilling", "combat"]
        .map((kind) => {
          const columns = weeks.flatMap((week) =>
            api
              .historyProjects(
                week.records.filter((record) => record.kind === kind),
                getBridge()?.trialHistoryContext?.details || {}
              )
              .flatMap((project) =>
                project.records.map(
                  (record) =>
                    `<article class="mwi-trial-column" data-trial-player-column data-trial-week="${e(week.key)}"><h4><button type="button" class="mwi-trial-heading-link" data-trial-jump-week="${e(week.key)}">${e(weekLabel(week))}</button></h4><h4><button type="button" class="mwi-trial-heading-link" data-trial-jump-project="${e(project.key)}">${projectIcon(record)}${e(trialName(record))}</button></h4>${renderRecord(record, true)}</article>`
                )
              )
          );
          if (!columns.length) return "";
          return renderRail(
            `player-${kind}`,
            t(kind === "skilling" ? "trialSkilling" : "trialCombat"),
            columns.join(""),
            kind,
            true,
            true
          );
        })
        .join("");
    }

    function renderRankingColumn(players, metric, scope, index, count) {
      const entries = [...players];
      const score = (entry) =>
        metric === "joinedAt"
          ? entry.joinedAt
          : metric === "participations"
            ? entry.participations
            : scope === "all"
              ? entry.all.total
              : entry[scope].average;
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
      entries.sort((a, b) => {
        const left = score(a),
          right = score(b);
        if (left === null || right === null)
          return left === right ? collator.compare(a.name, b.name) : left === null ? 1 : -1;
        return (
          (metric === "joinedAt" ? left - right : right - left) ||
          collator.compare(a.name, b.name) ||
          a.key.localeCompare(b.key)
        );
      });
      let previous = null,
        rank = 0;
      const rows = entries
        .map((entry, index) => {
          const value = score(entry);
          if (value !== previous) rank = index + 1;
          previous = value;
          const name = renderMemberName(entry);
          return `<tr data-trial-ranking-row="${e(entry.key)}"><td>${value === null ? "—" : rank}</td><th scope="row"${memberIdentityAttributes(entry)}>${entry.name ? `<button type="button" class="mwi-trial-heading-link" data-trial-ranking-player="${e(entry.key)}">${name}</button>` : name}</th><td><span data-trial-ranking-value>${metric === "joinedAt" ? joiningTime(value) : value === null ? "—" : metric === "participations" ? value : `${value.toFixed(2)}×`}</span></td>${metric === "average" ? `<td data-trial-ranking-samples>${entry[scope].sampleCount}</td>` : ""}</tr>`;
        })
        .join("");
      const title =
        metric === "joinedAt"
          ? t("trialRankingJoinedAt")
          : metric === "participations"
            ? t("trialRankingParticipations")
            : scope === "all"
              ? t("trialRankingTotalTitle")
              : t("trialRankingAverageTitle", { scope: t(`trialRankingScope_${scope}`) });
      const key = metric === "average" ? scope : metric;
      const icon = (path) =>
        `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="${path}"/></svg>`;
      const controls = `<div class="mwi-trial-ranking-controls"><button type="button" data-trial-ranking-move="${key}" data-direction="-1" aria-label="${e(t("trialRankingMoveLeft", { name: title }))}" title="${e(t("trialRankingMoveLeft", { name: title }))}"${index === 0 ? " disabled" : ""}>${icon("m9 4-4 4 4 4")}</button><button type="button" data-trial-ranking-drag="${key}" aria-label="${e(t("trialRankingDrag", { name: title }))}" title="${e(t("trialRankingDrag", { name: title }))}">${icon("M5 3v2m6-2v2M5 7v2m6-2v2M5 11v2m6-2v2")}</button><button type="button" data-trial-ranking-move="${key}" data-direction="1" aria-label="${e(t("trialRankingMoveRight", { name: title }))}" title="${e(t("trialRankingMoveRight", { name: title }))}"${index === count - 1 ? " disabled" : ""}>${icon("m7 4 4 4-4 4")}</button></div>`;
      return `<article class="mwi-trial-column" data-sort-key="${key}" data-trial-ranking-column="${key}"><h4>${e(title)}</h4>${controls}${entries.length ? `<table class="mwi-trial-table mwi-trial-ranking-table"><caption>${e(title)}</caption><thead><tr><th scope="col">${e(t("trialRankingRank"))}</th><th scope="col">${e(t("trialMember"))}</th><th scope="col">${e(t(metric === "joinedAt" ? "trialProfileJoinedAt" : metric === "participations" ? "trialRankingCount" : scope === "all" ? "trialRankingTotalMultiple" : "trialRankingMultiple"))}</th>${metric === "average" ? `<th scope="col">${e(t("trialRankingSamples"))}</th>` : ""}</tr></thead><tbody>${rows}</tbody></table>` : `<p class="mwi-trial-empty">${e(t(metric === "joinedAt" ? "trialRankingRosterEmpty" : "trialPlayerEmpty"))}</p>`}</article>`;
    }

    function renderRankings({ records, rankingOrder, orderSaveFailed }) {
      const players = api.playerRankings(records);
      const members = api.currentMembershipRankings(getBridge()?.trialHistoryContext);
      const columns = rankingOrder
        .map((key, index) =>
          renderRankingColumn(
            key === "joinedAt" ? members : players,
            key === "participations" || key === "joinedAt" ? key : "average",
            key,
            index,
            rankingOrder.length
          )
        )
        .join("");
      return `<div class="mwi-trial-rankings"><p class="mwi-trial-help" data-trial-ranking-order-status role="status">${orderSaveFailed ? e(t("trialRankingOrderSaveFailed")) : ""}</p>${renderRail("player-rankings", t("trialPlayerRankings"), columns, "rankings")}</div>`;
    }

    function render({ member, weeks, projects = [], profileState, profileSectionsOpen = {} }) {
      tooltipRecords.clear();
      return `<div class="mwi-trial-player-toolbar"><button type="button" data-trial-player-back>${e(t("trialPlayerBack"))}</button><h3 tabindex="-1" data-trial-player-title>${renderMemberName(member)} · ${e(t("trialPlayerHistory"))}</h3></div><div class="mwi-trial-player-layout"><aside class="mwi-trial-player-profile" aria-label="${e(t("trialPlayerProfile"))}"><header><h3>${e(t("trialPlayerProfile"))}</h3><button type="button" data-trial-profile-refresh ${profileState.status === "loading" ? "disabled" : ""}>${e(t("trialProfileRefresh"))}</button></header><div data-trial-profile-content>${profileMarkup(profileState, profileSectionsOpen, projects, member)}</div></aside><div class="mwi-trial-player-history">${historyMarkup(weeks)}</div></div>`;
    }
    return { render, renderRankings, tooltipData: (key) => tooltipRecords.get(key) };
  }
  return {
    createRenderer,
    createMemberNameFormatter,
    createMemberNameRenderer,
    nativeNameClasses,
    equipmentLayout,
    skillLayout,
    skillHouseLevel
  };
});


// SOURCE: src/ui/profile-tooltip.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildProfileTooltip = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function createTooltip({ document, pageWindow, host, getData, getProfile, getBridge, t }) {
    let anchor = null;
    let tooltip = null;
    let originalTitle = null;
    let hideTimer = null;
    function cancelHide() {
      if (hideTimer !== null) pageWindow.clearTimeout(hideTimer);
      hideTimer = null;
    }
    const listeners = [];
    const on = (node, type, handler, capture = false) => {
      node.addEventListener(type, handler, capture);
      listeners.push(() => node.removeEventListener(type, handler, capture));
    };
    function hide() {
      cancelHide();
      if (anchor) {
        anchor.removeAttribute("aria-describedby");
        if (originalTitle !== null) anchor.setAttribute("title", originalTitle);
      }
      if (tooltip) {
        getBridge()?.clearProfileTooltip?.(tooltip);
        tooltip.remove();
      }
      anchor = tooltip = null;
      originalTitle = null;
    }
    function position() {
      if (!anchor || !tooltip) return;
      const bounds = anchor.getBoundingClientRect();
      const size = tooltip.getBoundingClientRect();
      const width = document.documentElement.clientWidth;
      const height = pageWindow.innerHeight;
      const left = Math.max(8, Math.min(width - size.width - 8, bounds.left + (bounds.width - size.width) / 2));
      const top =
        bounds.top >= size.height + 8
          ? bounds.top - size.height - 6
          : Math.min(height - size.height - 8, bounds.bottom + 6);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${Math.max(8, Math.min(height - size.height - 8, top))}px`;
    }
    function show(target) {
      const next = target.closest?.("[data-trial-profile-tooltip]");
      if (next) cancelHide();
      if (!next || next === anchor) return;
      hide();
      const data = getData(next.dataset.trialProfileTooltip);
      const profile = getProfile();
      if (!data || !profile) return;
      anchor = next;
      originalTitle = anchor.getAttribute("title");
      anchor.removeAttribute("title");
      tooltip = document.createElement("div");
      tooltip.id = "mwi-trial-profile-tooltip";
      tooltip.className = "mwi-trial-profile-tooltip";
      tooltip.setAttribute("role", "tooltip");
      document.body.appendChild(tooltip);
      const hasExperience =
        data.kind === "item" || (Number.isFinite(data.record.level) && Number.isFinite(data.record.experience));
      if (!hasExperience || getBridge()?.renderProfileTooltip?.(tooltip, profile, data.kind, data.record) !== true) {
        tooltip.textContent = `${anchor.getAttribute("aria-label")}\n${t("trialProfileTooltipUnavailable")}`;
      }
      anchor.setAttribute("aria-describedby", tooltip.id);
      tooltip.addEventListener("mouseleave", (event) => {
        if (!anchor?.contains(event.relatedTarget)) hide();
      });
      tooltip.addEventListener("mouseenter", cancelHide);
      position();
    }
    on(host, "mouseover", (event) => show(event.target));
    on(host, "focusin", (event) => show(event.target));
    on(host, "mouseout", (event) => {
      if (
        anchor?.contains(event.target) &&
        !anchor.contains(event.relatedTarget) &&
        !tooltip?.contains(event.relatedTarget)
      )
        hideTimer = pageWindow.setTimeout(hide, 120);
    });
    on(host, "focusout", (event) => {
      if (anchor?.contains(event.target)) hide();
    });
    on(document, "keydown", (event) => {
      if (event.key === "Escape") hide();
    });
    on(
      document,
      "scroll",
      (event) => {
        if (!tooltip?.contains(event.target)) hide();
      },
      true
    );
    on(pageWindow, "resize", hide);
    on(
      host,
      "toggle",
      (event) => {
        if (!event.target.open && event.target.contains(anchor)) hide();
      },
      true
    );
    const observer = new pageWindow.MutationObserver(() => {
      if (anchor && (!anchor.isConnected || !anchor.checkVisibility())) hide();
    });
    observer.observe(host.closest("#mwi-credit-optimizer") || host, {
      attributes: true,
      subtree: true,
      childList: true,
      attributeFilter: ["hidden", "open", "style", "class"]
    });
    function dispose() {
      hide();
      observer.disconnect();
      listeners.forEach((remove) => remove());
    }
    return { hide, dispose };
  }
  return { createTooltip };
});


// SOURCE: src/ui/trial-screenshot.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildTrialScreenshot = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Bound allocation before creating a canvas; never silently crop or shrink text.
  function imageSize(width, height) {
    width = Math.ceil(width);
    height = Math.ceil(height);
    if (!(width > 0 && height > 0) || width > 16000 || height > 16000 || width * height > 24000000)
      throw Object.assign(new Error("Screenshot exceeds canvas budget"), { code: "trialScreenshotTooLarge" });
    const scale = Math.min(2, 16000 / width, 16000 / height, Math.sqrt(24000000 / (width * height)));
    return { width, height, pixelWidth: Math.floor(width * scale), pixelHeight: Math.floor(height * scale) };
  }

  const STYLE_PROPERTIES = (
    "display box-sizing width height min-width min-height max-width max-height margin-top margin-right margin-bottom margin-left " +
    "padding-top padding-right padding-bottom padding-left border-top border-right border-bottom border-left border-radius " +
    "border-collapse border-spacing table-layout background-color color opacity font-family font-size font-weight font-style " +
    "font-variant-numeric line-height letter-spacing text-align text-decoration text-transform text-indent white-space " +
    "word-break overflow-wrap vertical-align overflow overflow-x overflow-y position top right bottom left z-index " +
    "flex-direction flex-wrap flex-grow flex-shrink flex-basis align-items align-self align-content justify-content " +
    "gap justify-items grid-template-columns grid-auto-flow grid-auto-columns grid-column grid-row " +
    "list-style-type clip-path visibility fill stroke stroke-width background-image background-size background-position " +
    "background-repeat background-clip -webkit-background-clip -webkit-text-fill-color text-shadow filter transform " +
    "grid-template-rows grid-area"
  ).split(" ");

  function snapshot(host, document, pageWindow) {
    const stage = document.createElement("div");
    stage.dataset.trialScreenshotStage = "";
    stage.inert = true;
    stage.setAttribute("aria-hidden", "true");
    stage.style.cssText = "position:fixed;left:-100000px;top:0;width:1200px;pointer-events:none;";
    const copy = host.cloneNode(true);
    const projectView = Boolean(host.querySelector('[data-trial-mode="project"][aria-pressed="true"]'));
    if (projectView) {
      // History timelines are newest first. Limit the image only, never stored data.
      for (const timeline of copy.querySelectorAll(".mwi-trial-timeline"))
        [...timeline.children].slice(5).forEach((column) => column.remove());
    }
    // Only the selected view is captured. Remove navigation and implementation details,
    // but retain selected labels to identify the week/project and the visible columns.
    copy
      .querySelectorAll(
        ".mwi-trial-toolbar .mwi-trial-controls,.mwi-trial-guide,.mwi-trial-display-settings," +
          ".mwi-trial-scroll-buttons,.mwi-trial-player-picker,.mwi-trial-raw,.mwi-trial-import-preview," +
          "[data-role='trial-import-status'],[data-trial-image-status],[data-trial-image-help],input," +
          "[data-trial-player-back],[data-trial-profile-refresh],.mwi-trial-ranking-controls,[data-trial-ranking-order-hint],[data-trial-ranking-order-status]," +
          "[data-trial-mode][aria-pressed='false'],[data-trial-choice][aria-pressed='false']," +
          "script,style,iframe,img"
      )
      .forEach((element) => element.remove());
    for (const element of [copy, ...copy.querySelectorAll("*")]) {
      element.removeAttribute("id");
      if (element.matches(".mwi-trial-member-highlight,.mwi-trial-player-selected"))
        element.classList.remove("mwi-trial-member-highlight", "mwi-trial-player-selected");
    }
    copy.style.cssText =
      "display:block;width:1200px;max-width:none;height:auto;max-height:none;padding:24px;background:#191c2e;box-sizing:border-box;";
    stage.appendChild(copy);
    host.parentElement.appendChild(stage);
    try {
      for (const element of copy.querySelectorAll("[data-trial-scroll-id],.mwi-trial-table-scroll")) {
        Object.assign(element.style, { overflow: "visible", maxWidth: "none", maxHeight: "none", height: "auto" });
      }
      for (const element of copy.querySelectorAll(".mwi-trial-columns")) {
        const columns = element.classList.contains("mwi-trial-timeline")
          ? Math.min(5, element.children.length)
          : element.dataset.kind === "rankings"
            ? element.children.length
            : element.dataset.kind === "combat"
              ? 2
              : 4;
        Object.assign(element.style, {
          gridTemplateColumns: `repeat(${Math.max(1, columns)}, max-content)`,
          gridAutoFlow: "row",
          gridAutoColumns: "auto",
          gap: "24px"
        });
      }
      for (const element of copy.querySelectorAll("th")) element.style.position = "static";
      // Expand to include wide tables rather than clipping the rightmost column.
      const columns = [...copy.querySelectorAll(".mwi-trial-columns > .mwi-trial-column")];
      const origin = copy.getBoundingClientRect().left;
      const contentRight = Math.max(0, ...columns.map((column) => column.getBoundingClientRect().right - origin));
      const width = Math.ceil(Math.max(copy.querySelector(".mwi-trial-player-layout") ? 1200 : 480, contentRight + 24));
      copy.style.width = `${width}px`;
      imageSize(width, Math.max(copy.scrollHeight, copy.getBoundingClientRect().height));
      // Freeze computed styles while still under the real panel's CSS selectors.
      // Native custom names can draw additional text layers with pseudo-elements.
      // Materialize those layers before serializing the detached screenshot.
      const pseudoLayers = [];
      for (const element of copy.querySelectorAll(".mwi-trial-name-text[data-name]")) {
        for (const pseudo of ["::before", "::after"]) {
          const computed = pageWindow.getComputedStyle(element, pseudo);
          const content = computed.content;
          if (!content || content === "none" || content === "normal") continue;
          let text;
          if (/^attr\(data-name\)$/.test(content)) text = element.dataset.name;
          else {
            try {
              text = JSON.parse(content);
            } catch (_) {
              continue;
            }
          }
          if (typeof text !== "string") continue;
          const layer = document.createElement("span");
          layer.textContent = text;
          layer.setAttribute("aria-hidden", "true");
          layer.style.cssText = STYLE_PROPERTIES.map((name) => `${name}:${computed.getPropertyValue(name)};`).join("");
          pseudoLayers.push({ element, layer, pseudo });
        }
      }
      if (pseudoLayers.length) {
        const style = document.createElement("style");
        style.textContent =
          ".mwi-trial-name-text[data-name]::before,.mwi-trial-name-text[data-name]::after{content:none!important}";
        copy.append(style);
        for (const { element, layer, pseudo } of pseudoLayers)
          if (pseudo === "::before") element.prepend(layer);
          else element.append(layer);
      }
      const nodes = [copy, ...copy.querySelectorAll("*")];
      const styles = nodes.map((element) => {
        const computed = pageWindow.getComputedStyle(element);
        return STYLE_PROPERTIES.map((name) => `${name}:${computed.getPropertyValue(name)};`).join("");
      });
      nodes.forEach((element, index) => {
        element.style.cssText = styles[index];
        // Used table-cell heights include padding in some engines. Reapplying them
        // as CSS heights grows rows and overlaps subsequent sections in the SVG.
        if (element.namespaceURI !== "http://www.w3.org/2000/svg") element.style.height = "auto";
      });
      copy.style.containerType = "normal";
      const size = imageSize(width, Math.max(copy.scrollHeight, copy.getBoundingClientRect().height));
      copy.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      const content = new pageWindow.XMLSerializer().serializeToString(copy);
      return {
        ...size,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}"><foreignObject width="100%" height="100%">${content}</foreignObject></svg>`
      };
    } finally {
      stage.remove();
    }
  }

  const spriteCache = new Map();

  async function embedSprites(svg, pageWindow) {
    const parser = new pageWindow.DOMParser();
    const image = parser.parseFromString(svg, "image/svg+xml");
    const uses = [...image.querySelectorAll("use")];
    const sources = new Map();
    for (const use of uses) {
      const href = use.getAttribute("href") || use.getAttribute("xlink:href");
      if (!href || href.startsWith("#")) continue;
      const url = new URL(href, pageWindow.location.href);
      const id = decodeURIComponent(url.hash.slice(1));
      url.hash = "";
      if (!sources.has(url.href)) sources.set(url.href, []);
      sources.get(url.href).push({ use, id });
    }
    let index = 0;
    for (const [url, entries] of sources) {
      if (!spriteCache.has(url)) {
        const pending = (async () => {
          const controller = new pageWindow.AbortController();
          const timer = pageWindow.setTimeout(() => controller.abort(), 10000);
          try {
            const response = await pageWindow.fetch(url, { cache: "force-cache", signal: controller.signal });
            if (!response.ok) throw new Error("Sprite unavailable");
            const parsed = parser.parseFromString(await response.text(), "image/svg+xml");
            if (parsed.querySelector("parsererror")) throw new Error("Invalid sprite");
            return parsed;
          } finally {
            pageWindow.clearTimeout(timer);
          }
        })();
        spriteCache.set(url, pending);
        pending.catch(() => spriteCache.delete(url));
      }
      let source;
      try {
        source = await spriteCache.get(url);
      } catch (error) {
        throw Object.assign(error, { code: "trialScreenshotIconFailed" });
      }
      const prefix = `mwi-image-${index++}-`;
      const defs = image.createElementNS("http://www.w3.org/2000/svg", "defs");
      const included = new Set();
      const include = (id) => {
        if (included.has(id)) return;
        included.add(id);
        const original = source.getElementById(id);
        if (!original) throw Object.assign(new Error("Missing sprite symbol"), { code: "trialScreenshotIconFailed" });
        const copy = image.importNode(original, true);
        for (const node of [copy, ...copy.querySelectorAll("*")]) {
          if (node.id) node.id = prefix + node.id;
          for (const attribute of [...node.attributes]) {
            let value = attribute.value;
            if (attribute.localName === "href" && value.startsWith("#")) {
              include(value.slice(1));
              value = "#" + prefix + value.slice(1);
            }
            value = value.replace(/url\(["']?#([^\s)'"]+)["']?\)/g, (_match, reference) => {
              include(reference);
              return `url(#${prefix}${reference})`;
            });
            node.setAttributeNS(attribute.namespaceURI, attribute.name, value);
          }
        }
        defs.appendChild(copy);
      };
      for (const { use, id } of entries) {
        include(id);
        use.removeAttribute("xlink:href");
        use.setAttribute("href", `#${prefix}${id}`);
      }
      image.documentElement.prepend(defs);
    }
    return new pageWindow.XMLSerializer().serializeToString(image);
  }

  async function renderPng(host, { document, pageWindow }) {
    const captured = snapshot(host, document, pageWindow);
    const svg = await embedSprites(captured.svg, pageWindow);
    const image = new pageWindow.Image();
    await new Promise((resolve, reject) => {
      const timer = pageWindow.setTimeout(() => {
        image.src = "";
        reject(new Error("Image timeout"));
      }, 15000);
      image.onload = () => {
        pageWindow.clearTimeout(timer);
        resolve();
      };
      image.onerror = () => {
        pageWindow.clearTimeout(timer);
        reject(new Error("Image decode failed"));
      };
      // A self-contained data URL avoids external assets and SVG blob origin tainting.
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
    const canvas = document.createElement("canvas");
    canvas.width = captured.pixelWidth;
    canvas.height = captured.pixelHeight;
    try {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))), "image/png");
      });
    } finally {
      canvas.width = canvas.height = 0;
      image.src = "";
    }
  }

  function download(blob, { document, pageWindow }) {
    const url = pageWindow.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `guild-trial-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
    document.body.appendChild(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
      pageWindow.setTimeout(() => pageWindow.URL.revokeObjectURL(url), 60000);
    }
  }

  async function deliverPng(png, target, environment) {
    const { pageWindow } = environment;
    if (target === "copy") {
      try {
        if (!pageWindow.navigator.clipboard?.write || !pageWindow.ClipboardItem)
          throw new Error("Clipboard unavailable");
        await pageWindow.navigator.clipboard.write([new pageWindow.ClipboardItem({ "image/png": png })]);
        return "trialScreenshotCopied";
      } catch (error) {
        download(await png, environment);
        return "trialScreenshotFallback";
      }
    }
    download(await png, environment);
    return "trialScreenshotDownloaded";
  }

  function exportImage(host, target, environment) {
    // Schedule rendering after registering the clipboard write during user activation.
    return deliverPng(
      Promise.resolve().then(() => renderPng(host, environment)),
      target,
      environment
    );
  }

  return { imageSize, snapshot, renderPng, embedSprites, deliverPng, exportImage };
});


// SOURCE: src/ui/trial-signup-warning.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildTrialSignupWarning = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MODAL = '[class*="GuildPanel_signupModal__"]';
  const NAME = '[class*="GuildPanel_memberName__"]';
  const MARK = "data-mwi-trial-low-work";

  // Only decorate native signup names. React keeps the original nodes/handlers.
  function create({ document, pageWindow, trialHistoryApi, getRecords, getContext, t }) {
    const marked = new Map();
    let observer = null;
    let frame = null;
    let active = false;
    function restore(node, old) {
      node.removeAttribute(MARK);
      for (const key of ["title", "aria-description"])
        if (node.getAttribute(key) === old.message) {
          if (old[key] === null) node.removeAttribute(key);
          else node.setAttribute(key, old[key]);
        }
    }
    function refresh() {
      frame = null;
      if (!active) return;
      const context = getContext() || {};
      const wanted = new Map();
      for (const modal of document.querySelectorAll(MODAL)) {
        const heading = modal.querySelector('[class*="GuildPanel_name__"]')?.textContent.trim();
        // Resolve the project using the visible native title and known skilling
        // signups. Combat titles never enter this candidate set.
        const projects = [
          ...new Set(Object.values(context.signups || {}).map((s) => s?.signedUpSkillingTrialHrid))
        ].filter((hrid) => hrid && t(`trialName_${hrid.split("/").pop()}`) === heading);
        if (projects.length !== 1) continue;
        const warnings = trialHistoryApi.signupWorkWarnings(getRecords(), context, projects[0]);
        const byName = new Map();
        for (const [id, member] of Object.entries(context.roster || {})) {
          const name = member?.name || context.members?.[id]?.name;
          if (name) byName.set(name, byName.has(name) ? null : id);
        }
        for (const node of modal.querySelectorAll(NAME)) {
          const warning = warnings.get(byName.get(node.textContent.trim()));
          if (warning)
            wanted.set(
              node,
              t("trialSignupLowWork", {
                share: Math.floor(warning.share * 10000) / 10000,
                week: trialHistoryApi.weekNumber(warning.weekStartAt)
              })
            );
        }
      }
      for (const [node, old] of marked) {
        if (wanted.get(node) === old.message) continue;
        restore(node, old);
        marked.delete(node);
      }
      for (const [node, message] of wanted) {
        if (marked.has(node)) continue;
        marked.set(node, {
          title: node.getAttribute("title"),
          "aria-description": node.getAttribute("aria-description"),
          message
        });
        node.setAttribute(MARK, "true");
        node.setAttribute("title", message);
        node.setAttribute("aria-description", message);
      }
    }
    function schedule() {
      if (active && frame === null) frame = pageWindow.requestAnimationFrame(refresh);
    }
    function start() {
      if (active) return;
      active = true;
      observer = new pageWindow.MutationObserver((changes) => {
        if (
          changes.some((change) => {
            const target = change.target.nodeType === 1 ? change.target : change.target.parentElement;
            return (
              target?.closest?.(MODAL) ||
              [...change.addedNodes, ...change.removedNodes].some(
                (node) => node.nodeType === 1 && (node.matches(MODAL) || node.querySelector(MODAL))
              )
            );
          })
        )
          schedule();
      });
      // The development runtime can arrive at document-start, before body exists.
      // Watching the document also catches the initial body and later replacements.
      observer.observe(document, { childList: true, subtree: true, characterData: true });
      refresh();
    }
    function dispose() {
      active = false;
      observer?.disconnect();
      if (frame !== null) pageWindow.cancelAnimationFrame(frame);
      frame = null;
      for (const [node, old] of marked) restore(node, old);
      marked.clear();
    }
    return { start, refresh: schedule, dispose };
  }
  return { create };
});


// SOURCE: src/ui/trial-history-view.js
(function (root, factory) {
  const api = factory(
    typeof module !== "undefined" && module.exports ? require("../trial-display.js") : root.MwiGuildTrialDisplay,
    typeof module !== "undefined" && module.exports
      ? require("./trial-signup-warning.js")
      : root.MwiGuildTrialSignupWarning
  );
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildTrialHistoryView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (displayApi, signupWarningApi) {
  "use strict";

  function projectIconSpec(record, detail = record.trialDetail) {
    const project = String(record.trialHrid || "")
      .split("/")
      .pop();
    let sprite, symbol;
    if (record.kind === "skilling") {
      sprite = "skills_sprite";
      symbol = String(detail?.skillHrid || project)
        .split("/")
        .pop();
    } else if (record.kind === "combat") {
      const monsters = [...new Set(Array.isArray(detail?.monsterHrids) ? detail.monsterHrids : [])];
      if (monsters.length === 1) {
        sprite = "combat_monsters_sprite";
        symbol = String(monsters[0]).split("/").pop();
      } else if (monsters.length > 1 || project === "swarm") {
        sprite = "misc_sprite";
        symbol = "trial_swarm";
      } else if (["badger", "chameleon", "hedgehog", "jellyfish"].includes(project)) {
        sprite = "combat_monsters_sprite";
        symbol = `trial_${project}`;
      }
    }
    return sprite && /^[a-z0-9_]+$/.test(symbol || "") ? { sprite, symbol } : null;
  }

  function createTrialHistoryView({
    document,
    domApi,
    pageWindow,
    t,
    escapeHtml,
    pluginStorage,
    trialHistoryApi,
    playerViewApi,
    sortableApi,
    screenshotApi,
    profileTooltipApi,
    profileReaderApi,
    resolveItemName,
    getBridge,
    getPanel
  }) {
    let mode = "week";
    let screenshotMode = false;
    let simpleNames = false;
    let screenshotBusy = false;
    let screenshotNotice = "";
    const isScreenshotMode = () => screenshotMode;
    const formatMemberName = playerViewApi.createMemberNameFormatter({ t, isScreenshotMode });
    const renderMemberName = playerViewApi.createMemberNameRenderer({
      document,
      escapeHtml,
      formatMemberName,
      isPlain: () => screenshotMode || simpleNames,
      gameIcon
    });
    let selectedWeek = "";
    let selectedProject = "";
    let resetScroll = false;
    let resizeObserver = null;
    let profileTooltip = null;
    let records = [];
    let multipleGuilds = false;
    let loadFailed = false;
    let importPreview = null;
    let importNotice = null;
    let importBusy = false;
    let importRevision = 0;
    let displaySettingsOpen = false;
    let displaySaveFailed = false;
    let rankingOrder = displayApi.normalizeRankingOrder(pluginStorage.loadTrialRankingOrder());
    let rankingOrderSaveFailed = false;
    let rankingSortable = null;
    let rankingSortableHost = null;
    let displaySettings = displayApi.normalize(pluginStorage.loadTrialDisplay());
    const unsaved = new Map();
    const spriteBases = {};
    let spriteLoadPromise = null;
    let disposed = false;
    let displayedMembers = [];
    let highlightedMember = null;
    let hoveredMemberCell = null;
    let focusedMemberCell = null;
    let selectedMember = null;
    let profileState = { status: "loading" };
    const profileSectionsOpen = { overview: true, skills: true, equipment: true };
    let profileRevision = 0;
    let playerReturn = null;
    let playerSearch = "";
    let playerPickerOpen = true;
    let playerSearchComposing = false;

    function projectIcon(record) {
      const detail = getBridge()?.trialHistoryContext?.details?.[record.trialHrid] || record.trialDetail;
      const spec = projectIconSpec(record, detail);
      return spec ? gameIcon(spec.sprite, spec.symbol, "mwi-trial-project-icon") : "";
    }

    function profileIcon(kind, hrid) {
      return gameIcon(
        kind === "skill" ? "skills_sprite" : kind === "ability" ? "abilities_sprite" : "items_sprite",
        String(hrid || "")
          .split("/")
          .pop(),
        "mwi-trial-profile-icon"
      );
    }

    function gameIcon(sprite, symbol, className) {
      if (!/^[a-z0-9_]+$/.test(symbol || "")) return "";
      const nativeChatBase =
        sprite === "chat_icons_sprite"
          ? domApi.findSpriteBaseHref(document.querySelector('[class*="CharacterName_chatIcon__"]'), sprite)
          : "";
      let base = nativeChatBase || spriteBases[sprite] || domApi.findSpriteBaseHref(document, sprite);
      if (base) spriteBases[sprite] = base;
      else if (!spriteLoadPromise && pageWindow.fetch && pageWindow.location?.origin) {
        spriteLoadPromise = pageWindow
          .fetch(new URL("/asset-manifest.json", pageWindow.location.origin).href, { cache: "force-cache" })
          .then((response) => (response.ok ? response.json() : null))
          .then((manifest) => {
            for (const sprite of [
              "skills_sprite",
              "items_sprite",
              "abilities_sprite",
              "combat_monsters_sprite",
              "misc_sprite",
              "chat_icons_sprite"
            ]) {
              const reference = domApi.spriteBaseFromAssetManifest(manifest, sprite);
              // A cached manifest can predate the running game. Never replace a
              // sprite URL already observed in the native DOM with that cache.
              if (reference && !spriteBases[sprite])
                spriteBases[sprite] = new URL(reference, pageWindow.location.origin).href;
            }
            const panel = getPanel();
            if (!disposed && panel?.isConnected && panel.dataset.activeView === "trials") refresh(panel);
          })
          .catch(() => {});
      }
      return base
        ? `<svg class="${className}" width="20" height="20" aria-hidden="true" focusable="false"><use href="${escapeHtml(`${base}#${symbol}`)}" width="100%" height="100%"></use></svg>`
        : "";
    }
    const trialName = (record) => {
      const key = String(record.trialDetail?.skillHrid || record.trialHrid)
        .split("/")
        .pop();
      const label = t(`trialName_${key}`);
      return label === `trialName_${key}` ? String(record.trialDetail?.name || key) : label;
    };
    const number = (value) => (typeof value === "number" && Number.isFinite(value) ? String(value) : "—");

    const signupWarning = signupWarningApi.create({
      document,
      pageWindow,
      trialHistoryApi,
      t,
      getRecords: () => records,
      getContext: () => getBridge()?.trialHistoryContext
    });

    function reload() {
      const loaded = pluginStorage.loadTrialHistory();
      loadFailed = loaded.failed;
      const merged = new Map(loaded.records.map((record) => [record.key, record]));
      for (const [key, record] of unsaved) merged.set(key, record);
      records = Array.from(merged.values()).sort(trialHistoryApi.compareSnapshots);
      signupWarning.refresh();
      multipleGuilds =
        new Set(
          records.map((record) => JSON.stringify([record.guildId, record.guildId == null ? record.guildName : null]))
        ).size > 1;
    }

    function capture() {
      const bridge = getBridge();
      for (const record of bridge?.pendingTrialSnapshots?.splice(0) || []) unsaved.set(record.key, record);
      reload();
      for (const record of records) {
        const enriched = trialHistoryApi.withMembershipEvidence(
          trialHistoryApi.withMemberLevels(record, bridge?.trialHistoryContext),
          bridge?.trialHistoryContext
        );
        if (enriched !== record) unsaved.set(record.key, enriched);
      }
      for (const [key, record] of unsaved) {
        if (pluginStorage.saveTrialSnapshot(record)) unsaved.delete(key);
      }
      reload();
    }

    function recordDate(record) {
      if (record.weekStartAt) {
        const start = new Date(record.weekStartAt);
        const week = t("guildPointWeekWithDate", {
          count: trialHistoryApi.weekNumber(record.weekStartAt),
          date: `${start.getUTCMonth() + 1}/${start.getUTCDate()}`
        });
        return record.trialDate ? `${week} · ${record.trialDate}` : week;
      }
      return record.trialDate || t("trialUnknownDate");
    }

    function renderImport() {
      const preview = importPreview ? trialHistoryApi.previewImport(importPreview.records, records) : [];
      const count = (status) => preview.filter((entry) => entry.status === status).length;
      const summary = {
        added: count("new"),
        dated: count("dated"),
        duplicates: count("duplicate"),
        conflicts: count("conflict")
      };
      let markup = `<section class="mwi-trial-import" aria-label="${escapeHtml(t("trialDataTransfer"))}" aria-busy="${importBusy}">
        <header class="mwi-trial-toolbar"><div class="mwi-trial-heading"><h2>${escapeHtml(t("trialHistory"))}</h2><p class="mwi-trial-notice" data-state="${unsaved.size || loadFailed ? "warning" : "saved"}" role="status" aria-live="polite">${escapeHtml(t(unsaved.size ? "trialSaveFailed" : loadFailed ? "trialLoadFailed" : "trialSavedCount", { count: records.length }))}</p></div><div class="mwi-trial-controls"><button type="button" data-trial-simple-names aria-pressed="${simpleNames}">${escapeHtml(t("trialSimpleNames"))}</button><button type="button" data-trial-screenshot-mode aria-pressed="${screenshotMode}">${escapeHtml(t(screenshotMode ? "trialScreenshotExit" : "trialScreenshotMode"))}</button><button type="button" data-trial-image="copy"${screenshotBusy || !records.length ? " disabled" : ""}>${escapeHtml(t("trialScreenshotCopy"))}</button><button type="button" data-trial-image="download"${screenshotBusy || !records.length ? " disabled" : ""}>${escapeHtml(t("trialScreenshotDownload"))}</button><button type="button" data-role="trial-import-open"${importBusy ? " disabled" : ""}>${escapeHtml(t("trialImport"))}</button>
        <button type="button" data-role="trial-export"${records.length ? "" : ` disabled title="${escapeHtml(t("trialHistoryEmpty"))}"`}>${escapeHtml(t("trialExport"))}</button></div></header>

        <p class="mwi-trial-help" data-trial-image-status role="status" aria-live="polite">${escapeHtml(screenshotBusy ? t("trialScreenshotWorking") : screenshotNotice ? t(screenshotNotice) : "")}</p>
        <input type="file" accept=".json,application/json" data-role="trial-import-file" aria-label="${escapeHtml(t("trialImportFile"))}" hidden>

        <p data-role="trial-import-status" role="status" aria-live="polite" tabindex="-1">${escapeHtml(importBusy ? t("trialImportReading") : importNotice ? t(importNotice.key, importNotice.values) : "")}</p>`;
      if (importPreview) {
        markup += `<div class="mwi-trial-import-preview"><h3>${escapeHtml(t("trialImportPreview"))}</h3>
          <p class="mwi-trial-meta">${screenshotMode ? "" : `${escapeHtml(importPreview.name)}<br>`}${escapeHtml(t("trialImportSummary", summary))}</p>
          <ul class="mwi-trial-import-list" tabindex="0" aria-label="${escapeHtml(t("trialImportPreview"))}">${preview.map(({ record, status }) => `<li><strong>${escapeHtml(trialName(record))} · ${escapeHtml(t(`trialImportStatus_${status}`))}</strong><span>${escapeHtml(`${recordDate(record)} · ${record.guildName || t("trialUnknownGuild")}`)}</span><span>${escapeHtml(t("trialImportMemberCount", { count: record.rows.length }))} · ${escapeHtml(t(record.source === "manual" ? "trialManualSource" : "trialAutomaticSource"))}</span></li>`).join("")}</ul>
          <div class="mwi-trial-controls"><button type="button" data-role="trial-import-confirm"${!(summary.added + summary.dated) || importBusy ? " disabled" : ""}>${escapeHtml(t("trialImportConfirm", { count: summary.added + summary.dated }))}</button>
          <button type="button" data-role="trial-import-cancel">${escapeHtml(t("trialImportCancel"))}</button></div></div>`;
      }
      return markup + "</section>";
    }

    async function readImport(file, panel) {
      if (!file) return;
      const revision = ++importRevision;
      importPreview = null;
      importNotice = null;
      importBusy = true;
      refresh(panel);
      try {
        if (file.size > trialHistoryApi.MAX_IMPORT_BYTES)
          throw Object.assign(new Error(), { code: "trialImportTooLarge" });
        const text = await file.text();
        if (revision !== importRevision) return;
        importPreview = { name: file.name, records: trialHistoryApi.parseImport(text) };
      } catch (error) {
        if (revision !== importRevision) return;
        importNotice = {
          key:
            typeof error.code === "string" && error.code.startsWith("trialImport")
              ? error.code
              : "trialImportReadFailed",
          values: { index: error.recordIndex || "—" }
        };
      }
      if (revision !== importRevision) return;
      importBusy = false;
      refresh(panel);
      const next =
        panel.querySelector('[data-role="trial-import-confirm"]:not(:disabled)') ||
        panel.querySelector('[data-role="trial-import-cancel"]') ||
        panel.querySelector('[data-role="trial-import-status"]');
      next?.focus();
    }

    function confirmImport(panel) {
      if (!importPreview || importBusy) return;
      // Pending automatic captures also count as existing; never replace them
      // with an imported copy while browser storage is unavailable.
      capture();
      const plan = trialHistoryApi.previewImport(importPreview.records, records);
      const additions = plan.filter((entry) => ["new", "dated"].includes(entry.status)).map((entry) => entry.record);
      const result = additions.length
        ? pluginStorage.importTrialHistory(additions)
        : { status: "imported", added: 0, dated: 0, duplicates: 0, conflicts: 0 };
      result.duplicates += plan.filter((entry) => entry.status === "duplicate").length;
      result.conflicts += plan.filter((entry) => entry.status === "conflict").length;
      if (result.status === "imported") {
        if (result.added + result.dated) {
          selectedWeek = trialHistoryApi.historyWeeks([additions[0]])[0].key;
          selectedProject = trialHistoryApi.historyProjectKey(additions[0]);
          resetScroll = true;
        }
        importPreview = null;
      }
      importNotice = {
        key:
          result.status === "imported"
            ? "trialImportComplete"
            : result.status === "partial"
              ? "trialImportPartial"
              : "trialImportSaveFailed",
        values: result
      };
      refresh(panel);
      panel.querySelector('[data-role="trial-import-status"]')?.focus();
    }

    function weekLabel(week) {
      if (week.weekNumber === null) return t("trialUnknownWeek");
      const start = new Date(week.weekStartAt);
      return t("guildPointWeekWithDate", {
        count: week.weekNumber,
        date: `${start.getUTCMonth() + 1}/${start.getUTCDate()}`
      });
    }

    const tableSorts = new Map();
    function getSort(key, kind) {
      const fields = visibleFields(kind);
      const saved = tableSorts.get(key);
      if (saved && fields.includes(saved.field)) return saved;
      if (kind === "combat") return null;
      const field = ["workDone", "workShare", "workMultiple"].find((value) => fields.includes(value)) || fields[0];
      return field ? { field, direction: field === "member" ? "asc" : "desc" } : null;
    }
    function renderSortHeader(key, field, sort) {
      const label = t(field === "member" ? "trialMember" : `trialField_${field}`);
      const active = sort?.field === field;
      const next = active ? (sort.direction === "asc" ? "desc" : "asc") : field === "member" ? "asc" : "desc";
      const action = t(next === "asc" ? "trialSortAscending" : "trialSortDescending", { field: label });
      return `<th scope="col" aria-sort="${active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}"><button type="button" class="mwi-trial-sort" data-trial-sort="${field}" data-trial-sort-key="${escapeHtml(key)}" data-trial-sort-next="${next}" aria-label="${escapeHtml(action)}" title="${escapeHtml(action)}"><span>${escapeHtml(label)}</span><svg width="12" height="14" viewBox="0 0 12 14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${!active || sort.direction === "asc" ? '<path d="m3 5 3-3 3 3"/>' : ""}${!active || sort.direction === "desc" ? '<path d="m3 9 3 3 3-3"/>' : ""}</svg></button></th>`;
    }

    const playerRenderer = playerViewApi.createRenderer({
      t,
      escapeHtml,
      trialHistoryApi,
      trialName,
      weekLabel,
      projectIcon,
      profileIcon,
      getBridge,
      resolveItemName,
      renderRecord,
      renderRail,
      memberIdentityAttributes,
      formatMemberName,
      renderMemberName,
      isScreenshotMode
    });

    function readPlayerProfile(panel, force = false) {
      const revision = ++profileRevision;
      const member = selectedMember;
      profileState = { status: "loading" };
      refresh(panel);
      const receive = (result) => {
        if (disposed || revision !== profileRevision || mode !== "player" || selectedMember !== member) return;
        if (result.status === "ready") {
          const identity = profileReaderApi.profileIdentity(result.profile);
          if (member.id !== null && identity.id !== null && member.id !== identity.id) result = { status: "mismatch" };
        }
        profileState = result;
        refresh(panel);
      };
      const name =
        member.id != null ? getBridge()?.trialHistoryContext?.members?.[member.id]?.name || member.name : member.name;
      if (getBridge()?.requestProfile?.(name, receive, force) !== true) receive({ status: "unavailable" });
    }

    function leavePlayer() {
      profileRevision += 1;
      selectedMember = null;
      playerPickerOpen = true;
    }

    function renderMember(record, row, workSummary) {
      const rawName = record.members?.[row.memberKey ?? row.characterId]?.name;
      const identity = trialHistoryApi.memberIdentity(record, row);
      const name = formatMemberName(identity);
      const markup = renderMemberName(identity, record.members?.[row.memberKey ?? row.characterId]);
      const share = trialHistoryApi.lowWorkShare(record, row, workSummary);
      const warning = share === null ? "" : t("trialLowWork", { share: Math.floor(share * 10000) / 10000 });
      const warningAttributes = warning
        ? ` data-mwi-trial-low-work="true" title="${escapeHtml(warning)}" aria-description="${escapeHtml(warning)}"`
        : "";
      const absent = trialHistoryApi.memberAbsent(record, row, getBridge()?.trialHistoryContext);
      const label = escapeHtml(t("trialMemberAbsent"));
      return (
        (rawName
          ? `<button type="button" class="mwi-trial-profile-link"${warningAttributes} data-trial-profile="${escapeHtml(rawName)}" data-trial-identity="${escapeHtml(JSON.stringify(trialHistoryApi.memberIdentity(record, row)))}" aria-label="${escapeHtml(t("trialOpenProfile", { name }))}">${markup}</button>`
          : `<span${warningAttributes}>${markup}</span>`) +
        (absent
          ? ` <span class="mwi-trial-member-absent" role="img" tabindex="0" title="${label}" aria-label="${label}"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 4.5v4M8 10.5v1"/></svg></span>`
          : "")
      );
    }

    function memberAttributes(record, row) {
      if (mode !== "project" && mode !== "player") return "";
      return memberIdentityAttributes(trialHistoryApi.memberIdentity(record, row));
    }

    function memberIdentityAttributes(member) {
      const index = displayedMembers.push(member) - 1;
      return ` data-trial-member="${index}"`;
    }

    function updateMemberInteraction(host, target, keyboard) {
      const candidate = target?.closest?.("[data-trial-member]");
      const cell = candidate && host.contains(candidate) ? candidate : null;
      if (keyboard) focusedMemberCell = cell;
      else hoveredMemberCell = cell;
      highlightMember(host, hoveredMemberCell || focusedMemberCell);
    }

    function highlightMember(host, target) {
      const cell = target?.closest?.("[data-trial-member]");
      const index = cell && host.contains(cell) ? cell.dataset.trialMember : null;
      if (index === highlightedMember) return;
      highlightedMember = index;
      const member = index === null ? null : displayedMembers[Number(index)];
      for (const name of host.querySelectorAll("[data-trial-member]")) {
        name
          .closest("tr")
          .classList.toggle(
            "mwi-trial-member-highlight",
            Boolean(member && trialHistoryApi.sameMember(member, displayedMembers[Number(name.dataset.trialMember)]))
          );
      }
    }

    function visibleFields(kind) {
      return displayApi.fields(kind, displaySettings);
    }

    function displayLabel(field) {
      return t(
        field === "member" ? "trialMember" : field.includes("_") ? `trialAggregate_${field}` : `trialField_${field}`
      );
    }

    function renderDisplaySettings() {
      const counts = t("trialColumnsCount", {
        skilling: visibleFields("skilling").length,
        combat: visibleFields("combat").length
      });
      return `<details class="mwi-trial-display-settings" ${displaySettingsOpen ? "open" : ""}>
        <summary><span>${escapeHtml(t("trialMemberColumns"))}</span><small>${escapeHtml(counts)}</small><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></summary>
        <div class="mwi-trial-display-body"><div class="mwi-trial-display-toolbar"><div class="mwi-trial-display-presets" role="group" aria-label="${escapeHtml(t("trialColumnsPresets"))}">${["compact", "all", "default"].map((preset) => `<button type="button" data-trial-display-preset="${preset}">${escapeHtml(t(`trialColumnsPreset_${preset}`))}</button>`).join("")}</div></div>
        <div class="mwi-trial-display-groups">${displayApi.groups.map(({ key, fields }) => `<fieldset><legend>${escapeHtml(t(`trialColumnsGroup_${key}`))}<span>${fields.filter((field) => displaySettings[field]).length}/${fields.length}</span></legend><div class="mwi-trial-display-options">${fields.map((field) => `<label><input type="checkbox" role="switch" data-trial-display="${field}" ${displaySettings[field] ? "checked" : ""}><span>${escapeHtml(displayLabel(field))}</span><span class="mwi-trial-switch" aria-hidden="true"></span></label>`).join("")}</div></fieldset>`).join("")}</div>
</div>
        ${displaySaveFailed ? `<p role="status">${escapeHtml(t("trialDisplaySaveFailed"))}</p>` : ""}</details>`;
    }

    function applyDisplaySettings(panel, next, focusSelector) {
      displaySettings = next;
      displaySaveFailed = !pluginStorage.saveTrialDisplay(displaySettings);
      displaySettingsOpen = true;
      // Once hidden, an old sort must not silently reappear when a column is restored.
      for (const [key, sort] of tableSorts) if (!displaySettings[sort.field]) tableSorts.delete(key);
      refresh(panel);
      panel.querySelector(focusSelector)?.focus({ preventScroll: true });
    }

    function summaryNumber(value) {
      return value === null || !Number.isFinite(value) ? "—" : String(Number(value.toFixed(2)));
    }

    function renderOverview(record, summaries) {
      const items = Object.entries(summaries)
        .filter(([field]) => field === "level" || record.kind === "skilling")
        .map(([field, stats]) => {
          const aggregates = ["total", "average", "median"].filter(
            (aggregate) => displaySettings[`${field}_${aggregate}`]
          );
          if (!aggregates.length) return "";
          return `<div class="mwi-trial-overview-metric" data-trial-overview="${field}"><dl>${aggregates.map((aggregate) => `<div><dt>${escapeHtml(t(`trialAggregate_${field}_${aggregate}`))}</dt><dd data-trial-aggregate="${aggregate}">${escapeHtml(summaryNumber(stats[aggregate]))}</dd></div>`).join("")}</dl></div>`;
        })
        .join("");
      if (!items) return "";
      return `<div class="mwi-trial-overview" data-role="trial-overview" aria-label="${escapeHtml(t("trialOverview"))}">${items}</div>`;
    }

    function renderRecord(record, showIdentity) {
      const fields = visibleFields(record.kind);
      const summaries = Object.fromEntries(
        (record.kind === "combat"
          ? ["level", "damageDealt", "healingDone", "premitigatedDamageTaken"]
          : ["level", "workDone"]
        ).map((field) => [field, trialHistoryApi.summarizeMetric(record, field)])
      );
      const cellValue = (row, field) => {
        const derived = /^(damageDealt|healingDone|premitigatedDamageTaken)(Share|Multiple)$/.exec(field);
        if (derived) {
          const value = (derived[2] === "Share" ? trialHistoryApi.metricShare : trialHistoryApi.metricAverageMultiple)(
            record,
            row,
            derived[1],
            summaries[derived[1]]
          );
          return value === null ? "—" : `${value.toFixed(2)}${derived[2] === "Share" ? "%" : "×"}`;
        }
        if (field === "workMultiple") {
          const multiple = trialHistoryApi.metricAverageMultiple(record, row, "workDone", summaries.workDone);
          return multiple === null ? "—" : `${multiple.toFixed(2)}×`;
        }
        if (field === "workShare") {
          const share = trialHistoryApi.metricShare(record, row, "workDone", summaries.workDone);
          return share === null ? "—" : `${share.toFixed(2)}%`;
        }
        return number(
          field === "level" ? trialHistoryApi.memberLevel(record, row) : trialHistoryApi.metricValue(record, row, field)
        );
      };
      const caption = `${trialName(record)} · ${recordDate(record)} · ${t("trialStatsTable")}`;
      const sort = getSort(record.key, record.kind);
      const progress = trialHistoryApi.nextTierProgress(record);
      const progressLabel = progress === null ? "—" : `${Math.floor(progress * 100)}%`;
      // Sort only the displayed rows; stored records retain source order.
      return `<section class="mwi-trial-record" data-trial-record="${escapeHtml(record.key)}">
        ${showIdentity ? `<p class="mwi-trial-meta">${escapeHtml(record.guildName || t("trialUnknownGuild"))} · ${escapeHtml(t(record.source === "manual" ? "trialManualSource" : "trialAutomaticSource"))}</p>` : ""}
        <p class="mwi-trial-meta">${escapeHtml(t("trialSummary", { count: record.rows.length, points: number(record.points), tier: number(record.party.highestTier), progress: progressLabel }))}</p>
        ${renderOverview(record, summaries)}
        <div class="mwi-trial-table-scroll" data-trial-scroll-id="${escapeHtml(record.key)}" role="region" tabindex="0" aria-label="${escapeHtml(caption)}">${
          fields.length
            ? `<table class="mwi-trial-table" data-role="trial-stats-table"><caption>${escapeHtml(caption)}</caption><thead><tr>${fields.map((field) => renderSortHeader(record.key, field, sort)).join("")}</tr></thead><tbody>${trialHistoryApi
                .displayRows(record, sort)
                .map(
                  (row) =>
                    `<tr${mode === "player" && trialHistoryApi.sameMember(selectedMember, trialHistoryApi.memberIdentity(record, row)) ? ' class="mwi-trial-player-selected" data-trial-selected-member' : ""}>${fields.map((field) => (field === "member" ? `<th scope="row"${memberAttributes(record, row)}>${renderMember(record, row, summaries.workDone)}</th>` : `<td data-trial-field="${field}">${escapeHtml(cellValue(row, field))}</td>`)).join("")}</tr>`
                )
                .join("")}</tbody></table>`
            : `<p class="mwi-trial-columns-empty">${escapeHtml(t("trialColumnsEmpty"))}</p>`
        }</div>
        </section>`;
    }

    function renderColumn(title, items, attributes = "", jump = "", icon = "") {
      const showIdentity = items.length > 1 || multipleGuilds;
      return `<article class="mwi-trial-column" ${attributes}><h4>${jump ? `<button type="button" class="mwi-trial-heading-link" ${jump}>${icon}${escapeHtml(title)}</button>` : escapeHtml(title)}</h4>${items.length ? items.map((record) => renderRecord(record, showIdentity)).join("") : `<p class="mwi-trial-empty">${escapeHtml(t("trialMissingRecord"))}</p>`}</article>`;
    }

    function renderRail(id, title, columns, kind, timeline = false, showTitle = !timeline) {
      return `<section class="mwi-trial-group" data-trial-group="${id}" aria-labelledby="mwi-trial-heading-${id}"><header class="mwi-trial-group-header"><h3 id="mwi-trial-heading-${id}"${showTitle ? "" : " hidden"}>${escapeHtml(title)}</h3><div class="mwi-trial-scroll-buttons"><button type="button" data-trial-scroll="${id}" data-step="-1" aria-controls="mwi-trial-rail-${id}">${escapeHtml(t(timeline ? "trialNewer" : "trialScrollLeft"))}</button><button type="button" data-trial-scroll="${id}" data-step="1" aria-controls="mwi-trial-rail-${id}">${escapeHtml(t(timeline ? "trialOlder" : "trialScrollRight"))}</button></div></header><div class="mwi-trial-rail" id="mwi-trial-rail-${id}" data-trial-scroll-id="${id}" role="region" tabindex="0" aria-label="${escapeHtml(title)}"><div class="mwi-trial-columns ${timeline ? "mwi-trial-timeline" : "mwi-trial-week-grid"}" data-kind="${kind}">${columns}</div></div></section>`;
    }

    function updateScrollButtons(host) {
      for (const button of host.querySelectorAll("[data-trial-scroll]")) {
        const rail = host.querySelector(`#mwi-trial-rail-${button.dataset.trialScroll}`);
        button.disabled =
          !rail ||
          (button.dataset.step === "-1"
            ? rail.scrollLeft <= 1
            : rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 1);
      }
    }

    function renderChoices(kind, entries, current) {
      const label = t(
        kind === "week" ? "trialChooseWeek" : kind === "player" ? "trialChoosePlayer" : "trialChooseProject"
      );
      return `<div class="mwi-trial-choice-field"><span id="mwi-trial-choice-label">${escapeHtml(label)}</span><div class="mwi-trial-choices" data-role="trial-${kind}" data-trial-scroll-id="choice-${kind}" role="group" aria-labelledby="mwi-trial-choice-label">${entries.map(({ key, label: name, icon = "" }) => `<button type="button" data-trial-choice="${kind}" value="${escapeHtml(key)}" aria-pressed="${key === current}">${icon}<span>${escapeHtml(name)}</span></button>`).join("")}</div></div>`;
    }

    function renderPlayerResults(members, current) {
      const results = trialHistoryApi
        .searchHistoryMembers(
          members.map((member) => ({ member, name: formatMemberName(member) })),
          playerSearch
        )
        .map((result) => result.member);
      const names = new Map();
      for (const member of members) names.set(member.name, (names.get(member.name) || 0) + 1);
      return `<p class="mwi-trial-search-count" role="status">${escapeHtml(t("trialPlayerSearchCount", { count: results.length, total: members.length }))}</p><div class="mwi-trial-choices mwi-trial-player-results" data-role="trial-player" role="group" aria-label="${escapeHtml(t("trialChoosePlayer"))}">${results.map((member) => `<button type="button" data-trial-choice="player" value="${escapeHtml(member.key)}" aria-pressed="${member.key === current}">${renderMemberName(member)}${!screenshotMode && names.get(member.name) > 1 ? `<small>${escapeHtml(member.id === null ? t("trialManualSource") : `ID ${member.id}`)}</small>` : ""}</button>`).join("")}</div>${results.length ? "" : `<p class="mwi-trial-empty">${escapeHtml(t(members.length ? "trialPlayerSearchEmpty" : "trialNoNamedPlayers"))}</p>`}`;
    }

    function renderPlayerPicker(members, current) {
      const searchForm = `<form class="mwi-trial-player-search" data-trial-player-search-form role="search"><label for="mwi-trial-player-search">${escapeHtml(t("trialPlayerSearchLabel"))}</label><div class="mwi-trial-player-search-bar"><input id="mwi-trial-player-search" type="text" enterkeyhint="search" data-trial-player-search autocomplete="off" spellcheck="false" placeholder="${escapeHtml(t("trialPlayerSearchPlaceholder"))}" value="${escapeHtml(playerSearch)}" aria-controls="mwi-trial-player-results"><div class="mwi-trial-player-search-actions"><button type="submit">${escapeHtml(t("trialPlayerSearchButton"))}</button><button type="button" data-trial-player-search-clear>${escapeHtml(t("trialPlayerSearchClear"))}</button></div></div></form>`;
      return `<details class="mwi-trial-player-picker mwi-trial-choice-field" ${playerPickerOpen ? "open" : ""}><summary>${escapeHtml(selectedMember ? t("trialPlayerSwitch", { name: formatMemberName(selectedMember) }) : t("trialPlayerFind"))}</summary>${searchForm}<div id="mwi-trial-player-results">${renderPlayerResults(members, current)}</div></details>`;
    }

    function filterPlayerResults(host) {
      const input = host.querySelector("[data-trial-player-search]");
      if (!input) return;
      playerSearch = input.value;
      const members = trialHistoryApi.historyMembers(records);
      const current =
        host.querySelector('[data-trial-choice="player"][aria-pressed="true"]')?.value ||
        members.find((member) => selectedMember && trialHistoryApi.sameMember(member, selectedMember))?.key ||
        "";
      host.querySelector("#mwi-trial-player-results").innerHTML = renderPlayerResults(members, current);
    }

    function revealChoice(button) {
      if (!button || button.dataset.trialChoice === "player") return;
      const rail = button.parentElement;
      const bounds = rail.getBoundingClientRect();
      const item = button.getBoundingClientRect();
      if (item.left < bounds.left + 4) rail.scrollLeft += item.left - bounds.left - 4;
      else if (item.right > bounds.right - 4) rail.scrollLeft += item.right - bounds.right + 4;
    }

    function moveRanking(panel, key, toIndex) {
      const fromIndex = rankingOrder.indexOf(key);
      if (fromIndex < 0 || fromIndex === toIndex || toIndex < 0 || toIndex >= rankingOrder.length) return;
      rankingOrder = sortableApi.reorderByIndex(rankingOrder, fromIndex, toIndex);
      rankingOrderSaveFailed = !pluginStorage.saveTrialRankingOrder(rankingOrder);
      refresh(panel);
      const handle = panel.querySelector(`[data-trial-ranking-drag="${key}"]`);
      handle?.focus({ preventScroll: true });
      handle?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }

    function bindRankingSortable(panel) {
      rankingSortable?.destroy();
      if (!rankingSortableHost) return;
      rankingSortable = sortableApi.createPointerSortable({
        root: rankingSortableHost,
        containerSelector: '[data-kind="rankings"]',
        itemSelector: "[data-trial-ranking-column]",
        handleSelector: "[data-trial-ranking-drag]",
        axis: "x",
        scrollContainerSelector: ".mwi-trial-rail",
        onCommit: ({ key, toIndex }) => moveRanking(panel, key, toIndex)
      });
    }

    function refresh(panel) {
      // Cancel detached drags before a native update replaces the view.
      bindRankingSortable(panel);
      profileTooltip?.hide();
      capture();
      renderMemberName.refresh(records, getBridge()?.trialHistoryContext);
      const host = panel?.querySelector('[data-role="trials-view"]');
      if (!host) return;
      for (const section of host.querySelectorAll("[data-trial-profile-section]"))
        profileSectionsOpen[section.dataset.trialProfileSection] = section.open;
      const searchInput = document.activeElement?.matches("[data-trial-player-search]") ? document.activeElement : null;
      const searchSelection = searchInput ? [searchInput.selectionStart, searchInput.selectionEnd] : null;
      displayedMembers = [];
      highlightedMember = null;
      hoveredMemberCell = null;
      focusedMemberCell = null;
      const scroll = new Map(
        [...host.querySelectorAll("[data-trial-scroll-id]")].map((el) => [
          el.dataset.trialScrollId,
          [el.scrollLeft, el.scrollTop]
        ])
      );
      const weeks = trialHistoryApi.historyWeeks(records);
      const details = getBridge()?.trialHistoryContext?.details || {};
      const projects = trialHistoryApi.historyProjects(records, details);
      const week = weeks.find((entry) => entry.key === selectedWeek) || weeks[0];
      const project = projects.find((entry) => entry.key === selectedProject) || projects[0];
      selectedWeek = week?.key || "";
      selectedProject = project?.key || "";
      let markup = renderImport();
      markup += `<div class="mwi-trial-display-controls"><div class="mwi-trial-mode" role="group" aria-label="${escapeHtml(t("trialDisplayMode"))}">${["week", "project", "player"].map((value) => `<button type="button" data-trial-mode="${value}" aria-pressed="${mode === value}">${escapeHtml(t(value === "week" ? "trialByWeek" : value === "project" ? "trialByProject" : "trialByPlayer"))}</button>`).join("")}</div>`;
      if (mode === "player") {
        const members = trialHistoryApi.historyMembers(records);
        const selectedKey = selectedMember
          ? JSON.stringify([selectedMember.id === null ? "name" : "id", selectedMember.id ?? selectedMember.name])
          : "";
        const current =
          members.find((member) => member.key === selectedKey)?.key ||
          (selectedMember?.id === null ? members.find((member) => member.name === selectedMember.name)?.key : "") ||
          "";
        markup += "</div>";
        if (!selectedMember)
          markup += playerRenderer.renderRankings({
            records,
            rankingOrder,
            orderSaveFailed: rankingOrderSaveFailed
          });
        markup += renderPlayerPicker(members, current) + (selectedMember ? renderDisplaySettings() : "");
        host.innerHTML =
          markup +
          (selectedMember
            ? playerRenderer.render({
                member: selectedMember,
                projects: trialHistoryApi.playerProjectOverview(
                  records,
                  selectedMember,
                  getBridge()?.trialHistoryContext?.details || {}
                ),
                weeks: trialHistoryApi.memberHistory(records, selectedMember),
                profileState,
                profileSectionsOpen
              })
            : `<p class="mwi-status">${escapeHtml(t(members.length ? "trialSelectPlayerPrompt" : "trialNoNamedPlayers"))}</p>`);
        for (const el of host.querySelectorAll("[data-trial-scroll-id]")) {
          const position = scroll.get(el.dataset.trialScrollId);
          if (position && (!resetScroll || el.dataset.trialScrollId === "choice-player"))
            [el.scrollLeft, el.scrollTop] = position;
        }
        if (resetScroll) revealChoice(host.querySelector('[data-trial-choice="player"][aria-pressed="true"]'));
        resetScroll = false;
        updateScrollButtons(host);
        if (searchSelection) {
          const input = host.querySelector("[data-trial-player-search]");
          input?.focus({ preventScroll: true });
          input?.setSelectionRange(...searchSelection);
        }
        return;
      }
      if (!records.length) {
        host.innerHTML = markup + `</div><p class="mwi-status">${escapeHtml(t("trialHistoryEmpty"))}</p>`;
        return;
      }
      if (mode === "week") {
        markup +=
          renderChoices(
            "week",
            weeks.map((entry) => ({ key: entry.key, label: weekLabel(entry) })),
            selectedWeek
          ) +
          "</div>" +
          renderDisplaySettings();
        for (const [kind, size] of [
          ["skilling", 4],
          ["combat", 2]
        ]) {
          const columns = trialHistoryApi
            .historyProjects(
              week.records.filter((record) => record.kind === kind),
              details
            )
            .map((entry) =>
              renderColumn(
                trialName(entry.records[0]),
                entry.records,
                `data-trial-project="${escapeHtml(entry.key)}"`,
                `data-trial-jump-project="${escapeHtml(entry.key)}"`,
                projectIcon(entry.records[0])
              )
            );
          while (columns.length < size)
            columns.push(renderColumn(t("trialUnrecordedProject"), [], 'data-trial-empty="true"'));
          markup += renderRail(kind, t(kind === "combat" ? "trialCombat" : "trialSkilling"), columns.join(""), kind);
        }
      } else {
        markup +=
          renderChoices(
            "project",
            projects.map((entry) => ({
              key: entry.key,
              label: trialName(entry.records[0]),
              icon: projectIcon(entry.records[0])
            })),
            selectedProject
          ) +
          "</div>" +
          renderDisplaySettings();
        const timeline = trialHistoryApi.historyWeeks(project.records);
        markup += renderRail(
          "timeline",
          trialName(project.records[0]),
          timeline
            .map((entry) =>
              renderColumn(
                weekLabel(entry),
                entry.records,
                `data-trial-week="${entry.key}"`,
                `data-trial-jump-week="${entry.key}"`
              )
            )
            .join(""),
          project.kind,
          true
        );
      }
      host.innerHTML = markup;
      for (const el of host.querySelectorAll("[data-trial-scroll-id]")) {
        const position = scroll.get(el.dataset.trialScrollId);
        if (position && (!resetScroll || el.dataset.trialScrollId.startsWith("choice-")))
          [el.scrollLeft, el.scrollTop] = position;
      }
      if (resetScroll || !scroll.has(`choice-${mode}`))
        revealChoice(host.querySelector('[data-trial-choice][aria-pressed="true"]'));
      resetScroll = false;
      updateScrollButtons(host);
    }

    function exportHistory() {
      capture();
      const url = pageWindow.URL.createObjectURL(
        new pageWindow.Blob([JSON.stringify({ schemaVersion: 2, records }, null, 2)], { type: "application/json" })
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "guild-trial-history.json";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      pageWindow.setTimeout(() => pageWindow.URL.revokeObjectURL(url), 0);
    }

    async function exportScreenshot(host, target) {
      if (screenshotBusy) return;
      screenshotBusy = true;
      screenshotNotice = "";
      const update = () => {
        if (disposed || !host.isConnected) return;
        for (const button of host.querySelectorAll("[data-trial-image]"))
          button.disabled = screenshotBusy || !records.length;
        const status = host.querySelector("[data-trial-image-status]");
        if (status) status.textContent = t(screenshotBusy ? "trialScreenshotWorking" : screenshotNotice);
      };
      update();
      try {
        screenshotNotice = await screenshotApi.exportImage(host, target, { document, pageWindow });
      } catch (error) {
        screenshotNotice = ["trialScreenshotTooLarge", "trialScreenshotIconFailed"].includes(error.code)
          ? error.code
          : "trialScreenshotFailed";
      } finally {
        screenshotBusy = false;
        update();
      }
    }

    function bind(panel) {
      const host = panel.querySelector('[data-role="trials-view"]');
      rankingSortableHost = host;
      bindRankingSortable(panel);
      profileTooltip?.dispose();
      profileTooltip = profileTooltipApi?.createTooltip({
        document,
        pageWindow,
        host,
        getBridge,
        t,
        getData: playerRenderer.tooltipData,
        getProfile: () =>
          !screenshotMode && selectedMember && profileState.status === "ready" ? profileState.profile : null
      });
      if (pageWindow.ResizeObserver) {
        resizeObserver = new pageWindow.ResizeObserver(() => updateScrollButtons(host));
        resizeObserver.observe(host);
      }
      for (const type of ["mouseover", "focusin"])
        host.addEventListener(type, (event) => updateMemberInteraction(host, event.target, type === "focusin"));
      for (const type of ["mouseout", "focusout"])
        host.addEventListener(type, (event) => updateMemberInteraction(host, event.relatedTarget, type === "focusout"));
      host.addEventListener(
        "toggle",
        (event) => {
          if (event.target.matches(".mwi-trial-display-settings")) displaySettingsOpen = event.target.open;
          if (event.target.matches(".mwi-trial-player-picker") && event.target.isConnected)
            playerPickerOpen = event.target.open;
        },
        true
      );
      host.addEventListener("change", (event) => {
        const field = event.target.dataset.trialDisplay;
        if (Object.hasOwn(displayApi.defaults, field)) {
          applyDisplaySettings(
            panel,
            { ...displaySettings, [field]: event.target.checked },
            `[data-trial-display="${field}"]`
          );
          return;
        }
        if (event.target.dataset.role === "trial-import-file") {
          void readImport(event.target.files?.[0], panel);
          return;
        }
      });
      host.addEventListener("compositionstart", (event) => {
        if (event.target.matches("[data-trial-player-search]")) playerSearchComposing = true;
      });
      host.addEventListener("compositionend", (event) => {
        if (event.target.matches("[data-trial-player-search]")) {
          playerSearchComposing = false;
          filterPlayerResults(host);
        }
      });
      host.addEventListener("input", (event) => {
        if (event.target.matches("[data-trial-player-search]") && !event.isComposing && !playerSearchComposing)
          filterPlayerResults(host);
      });
      host.addEventListener("submit", (event) => {
        if (!event.target.matches("[data-trial-player-search-form]")) return;
        event.preventDefault();
        if (!playerSearchComposing) filterPlayerResults(host);
      });
      host.addEventListener("keydown", (event) => {
        const button = event.target.closest("[data-trial-choice]");
        if (!button || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const buttons = [...button.parentElement.querySelectorAll("[data-trial-choice]")];
        const current = buttons.indexOf(button);
        const index =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : Math.max(0, Math.min(buttons.length - 1, current + (event.key === "ArrowRight" ? 1 : -1)));
        if (button.dataset.trialChoice === "player") buttons[index].focus();
        else buttons[index].click();
      });
      host.addEventListener("scroll", () => updateScrollButtons(host), true);
      host.addEventListener("click", (event) => {
        const moveButton = event.target.closest("[data-trial-ranking-move]");
        if (moveButton) {
          const key = moveButton.dataset.trialRankingMove;
          moveRanking(panel, key, rankingOrder.indexOf(key) + Number(moveButton.dataset.direction));
          return;
        }
        const presetButton = event.target.closest("[data-trial-display-preset]");
        if (presetButton) {
          const preset = presetButton.dataset.trialDisplayPreset;
          const next = displayApi.preset(preset);
          if (next) applyDisplaySettings(panel, next, `[data-trial-display-preset="${preset}"]`);
          return;
        }
        const imageButton = event.target.closest("[data-trial-image]");
        if (imageButton) {
          void exportScreenshot(host, imageButton.dataset.trialImage);
          return;
        }
        if (event.target.closest("[data-trial-simple-names]")) {
          simpleNames = !simpleNames;
          refresh(panel);
          host.querySelector("[data-trial-simple-names]")?.focus({ preventScroll: true });
          return;
        }
        if (event.target.closest("[data-trial-screenshot-mode]")) {
          screenshotMode = !screenshotMode;
          playerSearch = "";
          playerSearchComposing = false;
          refresh(panel);
          host.querySelector("[data-trial-screenshot-mode]")?.focus({ preventScroll: true });
          return;
        }
        const rankingPlayer = event.target.closest("[data-trial-ranking-player]");
        if (rankingPlayer) {
          const member = (
            rankingPlayer.closest('[data-trial-ranking-column="joinedAt"]')
              ? trialHistoryApi.currentMembershipRankings(getBridge()?.trialHistoryContext)
              : trialHistoryApi.playerRankings(records)
          ).find((entry) => entry.key === rankingPlayer.dataset.trialRankingPlayer);
          if (!member?.name) return;
          playerReturn = {
            mode: "player",
            rankingKey: member.key,
            rankingColumn: rankingPlayer.closest("[data-trial-ranking-column]").dataset.trialRankingColumn,
            scroll: [...host.querySelectorAll("[data-trial-scroll-id]")].map((el) => [
              el.dataset.trialScrollId,
              el.scrollLeft,
              el.scrollTop
            ])
          };
          selectedMember = { id: member.id, name: member.name };
          playerPickerOpen = false;
          resetScroll = true;
          readPlayerProfile(panel);
          host.querySelector("[data-trial-player-title]")?.focus({ preventScroll: true });
          return;
        }
        if (event.target.closest("[data-trial-player-search-clear]")) {
          const input = host.querySelector("[data-trial-player-search]");
          input.value = "";
          filterPlayerResults(host);
          input.focus();
          return;
        }
        const sortButton = event.target.closest("[data-trial-sort]");
        if (sortButton) {
          const { trialSort: field, trialSortKey: key, trialSortNext: direction } = sortButton.dataset;
          tableSorts.set(key, { field, direction });
          refresh(panel);
          [...host.querySelectorAll("[data-trial-sort]")]
            .find((button) => button.dataset.trialSortKey === key && button.dataset.trialSort === field)
            ?.focus({ preventScroll: true });
          return;
        }
        const profile = event.target.closest("[data-trial-profile]");
        if (profile) {
          if (mode !== "player")
            playerReturn = {
              mode,
              scroll: [...host.querySelectorAll("[data-trial-scroll-id]")].map((el) => [
                el.dataset.trialScrollId,
                el.scrollLeft,
                el.scrollTop
              ]),
              name: profile.dataset.trialProfile
            };
          selectedMember = JSON.parse(profile.dataset.trialIdentity);
          playerPickerOpen = false;
          resetScroll = true;
          mode = "player";
          readPlayerProfile(panel);
          host.querySelector("[data-trial-player-title]")?.focus({ preventScroll: true });
          return;
        }
        if (event.target.closest("[data-trial-profile-refresh]")) {
          readPlayerProfile(panel, true);
          return;
        }
        if (event.target.closest("[data-trial-player-back]")) {
          leavePlayer();
          mode = playerReturn?.mode || "week";
          refresh(panel);
          for (const [key, left, top] of playerReturn?.scroll || []) {
            const element = [...host.querySelectorAll("[data-trial-scroll-id]")].find(
              (el) => el.dataset.trialScrollId === key
            );
            if (element) {
              element.scrollLeft = left;
              element.scrollTop = top;
            }
          }
          const returnTarget =
            [...host.querySelectorAll("[data-trial-ranking-player]")].find(
              (el) =>
                el.dataset.trialRankingPlayer === playerReturn?.rankingKey &&
                el.closest("[data-trial-ranking-column]").dataset.trialRankingColumn === playerReturn?.rankingColumn
            ) ||
            [...host.querySelectorAll("[data-trial-profile]")].find(
              (el) => el.dataset.trialProfile === playerReturn?.name
            ) ||
            host.querySelector(`[data-trial-mode="${mode}"]`);
          returnTarget?.focus({ preventScroll: true });
          updateScrollButtons(host);
          return;
        }
        const jump = event.target.closest("[data-trial-jump-week], [data-trial-jump-project]");
        if (jump) {
          leavePlayer();
          if (jump.dataset.trialJumpWeek !== undefined) {
            mode = "week";
            selectedWeek = jump.dataset.trialJumpWeek;
          } else {
            mode = "project";
            selectedProject = jump.dataset.trialJumpProject;
          }
          resetScroll = true;
          refresh(panel);
          host.querySelector('[data-trial-choice][aria-pressed="true"]')?.focus({ preventScroll: true });
          return;
        }
        const choice = event.target.closest("[data-trial-choice]");
        if (choice) {
          resetScroll = true;
          if (choice.dataset.trialChoice === "player") {
            const member = trialHistoryApi.historyMembers(records).find((entry) => entry.key === choice.value);
            if (!member) return;
            selectedMember = { id: member.id, name: member.name };
            playerPickerOpen = false;
            readPlayerProfile(panel);
            host.querySelector("[data-trial-player-title]")?.focus({ preventScroll: true });
            return;
          } else {
            if (choice.dataset.trialChoice === "week") selectedWeek = choice.value;
            else selectedProject = choice.value;
            refresh(panel);
          }
          const active = host.querySelector('[data-trial-choice][aria-pressed="true"]');
          active?.focus({ preventScroll: true });
          revealChoice(active);
        }
        const modeButton = event.target.closest("[data-trial-mode]");
        if (modeButton) {
          const nextMode = modeButton.dataset.trialMode;
          if (nextMode !== mode) {
            if (nextMode === "player")
              playerReturn = {
                mode,
                scroll: [...host.querySelectorAll("[data-trial-scroll-id]")].map((el) => [
                  el.dataset.trialScrollId,
                  el.scrollLeft,
                  el.scrollTop
                ])
              };
            if (mode === "player") leavePlayer();
            mode = nextMode;
          } else if (mode === "player" && selectedMember) leavePlayer();
          resetScroll = true;
          refresh(panel);
          host.querySelector(`[data-trial-mode="${mode}"]`)?.focus();
        }
        const scrollButton = event.target.closest("[data-trial-scroll]");
        if (scrollButton) {
          const rail = host.querySelector(`#mwi-trial-rail-${scrollButton.dataset.trialScroll}`);
          rail?.scrollBy({ left: Number(scrollButton.dataset.step) * rail.clientWidth * 0.85 });
          updateScrollButtons(host);
        }
        if (event.target.closest('[data-role="trial-import-open"]'))
          host.querySelector('[data-role="trial-import-file"]').click();
        if (event.target.closest('[data-role="trial-import-confirm"]')) confirmImport(panel);
        if (event.target.closest('[data-role="trial-import-cancel"]')) {
          importRevision += 1;
          importPreview = null;
          importBusy = false;
          importNotice = null;
          refresh(panel);
          host.querySelector('[data-role="trial-import-open"]')?.focus();
        }
        if (event.target.closest('[data-role="trial-export"]')) exportHistory();
      });
    }
    const onStats = () => {
      capture();
      const panel = getPanel();
      if (panel && panel.dataset.activeView === "trials") refresh(panel);
    };
    function start() {
      disposed = false;
      const bridge = getBridge();
      if (bridge) bridge.onTrialStatsUpdated = onStats;
      capture();
      signupWarning.start();
    }
    function dispose() {
      signupWarning.dispose();
      rankingSortable?.destroy();
      rankingSortableHost = null;
      profileTooltip?.dispose();
      disposed = true;
      profileRevision += 1;
      getBridge()?.disposeProfileReader?.();
      importRevision += 1;
      resizeObserver?.disconnect();
      const bridge = getBridge();
      if (bridge?.onTrialStatsUpdated === onStats) bridge.onTrialStatsUpdated = null;
    }
    return { start, dispose, bind, refresh };
  }
  return { createTrialHistoryView, projectIconSpec };
});


// SOURCE: src/ui/shrine-effects.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildShrineEffects = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function createFormatter({ core, t, ui }) {
    const effectNameKeys = {
      action_speed: "shrineEffectActionSpeed",
      attack_speed: "shrineEffectAttackSpeed",
      cast_speed: "shrineEffectCastSpeed",
      efficiency: "shrineEffectEfficiency",
      damage: "shrineEffectDamage",
      essence_find: "shrineEffectEssenceFind",
      max_hitpoints: "shrineEffectMaxHp",
      max_manapoints: "shrineEffectMaxMp",
      rare_find: "shrineEffectRareFind",
      wisdom: "shrineEffectExperience",
      skilling_experience: "shrineEffectExperience",
      combat_experience: "shrineEffectExperience"
    };
    const flatPercentTypes = new Set([
      "action_speed",
      "cast_speed",
      "efficiency",
      "essence_find",
      "rare_find",
      "wisdom",
      "skilling_experience",
      "combat_experience",
      "damage",
      "critical_rate",
      "critical_damage",
      "physical_amplify",
      "water_amplify",
      "nature_amplify",
      "fire_amplify",
      "healing_amplify",
      "life_steal",
      "physical_thorns",
      "elemental_thorns",
      "retaliation",
      "hp_regen",
      "mp_regen",
      "combat_drop_rate",
      "combat_drop_quantity",
      "gathering",
      "task_action_speed",
      "gourmet",
      "processing",
      "artisan",
      "blessed"
    ]);

    function name(effect) {
      const type = effect.typeHrid.split("/").pop();
      return effectNameKeys[type] ? t(effectNameKeys[type]) : effect.typeHrid;
    }
    function value(effect, number) {
      if (number === null || !Number.isFinite(number)) return "—";
      const percent = effect.kind === "ratio" || flatPercentTypes.has(effect.typeHrid.split("/").pop());
      return new Intl.NumberFormat(ui().locale, {
        style: percent ? "percent" : "decimal",
        maximumFractionDigits: 3,
        signDisplay: "always"
      }).format(number);
    }
    function perLevel(detail, separator = " · ") {
      const effects = core.guildBuffLevelEffects(detail);
      if (!effects.length) return t("shrineEffectsUnavailable");
      return effects
        .map((effect) =>
          t(effect.first === effect.increment ? "shrineEffectPerLevel" : "shrineEffectFirstAndPerLevel", {
            effect: name(effect),
            value: value(effect, effect.increment),
            first: value(effect, effect.first)
          })
        )
        .join(separator);
    }
    function summary(detail) {
      const effects = core.guildBuffLevelEffects(detail);
      if (!effects.length) return t("shrineEffectsUnavailable");
      const describe = (field) =>
        effects.map((effect) => `${name(effect)} ${value(effect, effect[field])}`).join(" · ");
      return effects.every((effect) => effect.first === effect.increment)
        ? t("shrineEffectsPerLevel", { effects: describe("increment") })
        : t("shrineEffectsFirstAndPerLevel", { first: describe("first"), later: describe("increment") });
    }
    return { name, value, perLevel, summary };
  }
  return { createFormatter };
});


// SOURCE: src/ui/shrine-picker.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildShrinePicker = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  let sequence = 0;
  const chevron =
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>';
  const check =
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>';

  // The hidden select remains the local plan adapter; only these controls receive user input.
  function createManager(host, escapeHtml) {
    const doc = host.ownerDocument;
    const win = doc.defaultView;
    const controls = new WeakMap();
    let opened = null;
    let describe = () => ({});

    function close(restoreFocus = false) {
      if (!opened) return;
      const { trigger, popup, controller, observer } = opened;
      opened = null;
      controller.abort();
      observer.disconnect();
      trigger.setAttribute("aria-expanded", "false");
      popup.remove();
      if (restoreFocus && trigger.isConnected) trigger.focus({ preventScroll: true });
    }

    function open(select, initial = null) {
      close();
      const trigger = controls.get(select);
      if (!trigger || select.disabled || !trigger.isConnected) return;
      const options = [...select.options];
      const popup = doc.createElement("div");
      popup.className = "mwi-shrine-picker-popover";
      popup.id = trigger.getAttribute("aria-controls");
      popup.setAttribute("popover", "auto");
      popup.setAttribute("role", "listbox");
      popup.setAttribute("aria-label", select.getAttribute("aria-label"));
      popup.tabIndex = -1;
      let previousGroup = null;
      let groupNode = popup;
      options.forEach((option, index) => {
        const group = option.parentElement.tagName === "OPTGROUP" ? option.parentElement : null;
        if (group !== previousGroup) {
          previousGroup = group;
          groupNode = doc.createElement("div");
          groupNode.setAttribute("role", "group");
          const heading = doc.createElement("div");
          heading.className = "mwi-shrine-picker-group";
          heading.id = `${popup.id}-group-${index}`;
          heading.textContent = group.label;
          groupNode.setAttribute("aria-labelledby", heading.id);
          groupNode.append(heading);
          popup.append(groupNode);
        }
        const item = doc.createElement("div");
        const details = describe(select, option);
        item.id = `${popup.id}-option-${index}`;
        item.className = "mwi-shrine-picker-option";
        item.dataset.optionIndex = String(index);
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(option.selected));
        item.setAttribute("aria-disabled", String(option.disabled || group?.disabled || false));
        item.setAttribute("aria-labelledby", `${item.id}-name`);
        if (details.description || details.reason) item.setAttribute("aria-describedby", `${item.id}-description`);
        item.innerHTML = `${details.icon ? `<span class="mwi-shrine-picker-icon" aria-hidden="true">${details.icon}</span>` : ""}<span class="mwi-shrine-picker-copy"><span id="${item.id}-name">${escapeHtml(option.textContent)}</span>${details.description || details.reason ? `<small id="${item.id}-description">${escapeHtml([details.description, details.reason].filter(Boolean).join(" · "))}</small>` : ""}</span><span class="mwi-shrine-picker-check">${option.selected ? check : ""}</span>`;
        groupNode.append(item);
      });
      doc.body.append(popup);
      const controller = new win.AbortController();
      const observer = new win.MutationObserver(() => {
        if (!trigger.isConnected || !trigger.getClientRects().length) close();
      });
      const events = { signal: controller.signal };
      const items = [...popup.querySelectorAll('[role="option"]')];
      const enabled = items.filter((item) => item.getAttribute("aria-disabled") !== "true");
      let activeIndex = -1;
      let typed = "";
      let typedAt = 0;
      function activate(item) {
        if (!item || !enabled.includes(item)) return;
        items[activeIndex]?.removeAttribute("data-active");
        activeIndex = items.indexOf(item);
        item.dataset.active = "true";
        popup.setAttribute("aria-activedescendant", item.id);
        item.scrollIntoView({ block: "nearest" });
      }
      function choose(item) {
        if (!enabled.includes(item)) return;
        const value = options[Number(item.dataset.optionIndex)].value;
        close(true);
        if (value === select.value) return;
        select.value = value;
        select.dispatchEvent(new win.Event("change", { bubbles: true }));
      }
      function position() {
        if (!trigger.isConnected || !trigger.getClientRects().length) return close();
        const rect = trigger.getBoundingClientRect();
        const panel = host.closest("#mwi-credit-optimizer").getBoundingClientRect();
        const width = Math.min(
          select.dataset.role === "plan-buff" ? Math.max(rect.width, 280) : Math.max(rect.width, 144),
          panel.width - 24,
          win.innerWidth - 16
        );
        popup.style.width = `${width}px`;
        popup.style.left = `${Math.max(8, Math.min(rect.left, panel.right - width - 12, win.innerWidth - width - 8))}px`;
        const below = win.innerHeight - rect.bottom - 12;
        const above = rect.top - 12;
        const upwards = below < Math.min(300, popup.scrollHeight) && above > below;
        popup.style.maxHeight = `${Math.max(80, Math.min(420, upwards ? above : below))}px`;
        popup.style.top = `${upwards ? Math.max(8, rect.top - popup.getBoundingClientRect().height - 6) : rect.bottom + 6}px`;
      }
      opened = { select, trigger, popup, controller, observer };
      trigger.setAttribute("aria-expanded", "true");
      if (typeof popup.showPopover === "function") popup.showPopover();
      else popup.dataset.fallback = "true";
      position();
      popup.focus({ preventScroll: true });
      activate(
        items.find((item, index) => options[index].value === initial) || items[select.selectedIndex] || enabled[0]
      );
      if (activeIndex < 0) activate(enabled[0]);
      popup.addEventListener("click", (event) => choose(event.target.closest('[role="option"]')), events);
      popup.addEventListener("pointermove", (event) => activate(event.target.closest('[role="option"]')), events);
      popup.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close(true);
          } else if (event.key === "Tab") {
            close(true); // Native Tab proceeds from the trigger to the next/previous field.
          } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const index = enabled.indexOf(items[activeIndex]);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? enabled.length - 1
                  : (index + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
            activate(enabled[next]);
          } else if (["Enter", " "].includes(event.key)) {
            event.preventDefault();
            choose(items[activeIndex]);
          } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            const now = Date.now();
            typed = now - typedAt > 700 ? event.key : typed + event.key;
            typedAt = now;
            const query = typed.toLocaleLowerCase();
            activate(
              enabled.find((item) =>
                (select.dataset.role !== "plan-buff"
                  ? options[Number(item.dataset.optionIndex)].value
                  : options[Number(item.dataset.optionIndex)].textContent
                )
                  .trim()
                  .toLocaleLowerCase()
                  .startsWith(query)
              )
            );
          }
        },
        events
      );
      popup.addEventListener(
        "toggle",
        (event) => {
          if (event.newState === "closed" && opened?.popup === popup) close();
        },
        events
      );
      doc.addEventListener(
        "pointerdown",
        (event) => {
          if (!popup.contains(event.target) && !trigger.contains(event.target)) close();
        },
        events
      );
      doc.addEventListener(
        "scroll",
        (event) => {
          if (!popup.contains(event.target)) close();
        },
        { ...events, capture: true }
      );
      win.addEventListener("resize", position, events);
      observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
    }

    function capture() {
      const active = doc.activeElement;
      const select = opened?.select || (active?.dataset?.pickerRole ? active.previousElementSibling : null);
      if (!select || !host.contains(select)) return null;
      return {
        plan: select.closest("[data-plan-id]").dataset.planId,
        role: select.dataset.role,
        open: Boolean(opened)
      };
    }

    function sync(description, snapshot, replaced) {
      describe = description;
      if (replaced) close();
      for (const select of host.querySelectorAll(
        'select[data-role="plan-buff"],select[data-role="plan-start"],select[data-role="plan-target"]'
      )) {
        let trigger = controls.get(select);
        if (!trigger) {
          select.hidden = true;
          select.tabIndex = -1;
          trigger = doc.createElement("button");
          trigger.type = "button";
          trigger.className = "mwi-shrine-picker-trigger";
          trigger.dataset.pickerRole = select.dataset.role;
          trigger.setAttribute("role", "combobox");
          trigger.setAttribute("aria-haspopup", "listbox");
          trigger.setAttribute("aria-expanded", "false");
          trigger.setAttribute("aria-controls", `mwi-shrine-picker-${++sequence}`);
          select.after(trigger);
          controls.set(select, trigger);
          trigger.addEventListener("click", () => (opened?.select === select ? close(true) : open(select)));
          trigger.addEventListener("keydown", (event) => {
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const enabled = [...select.options].filter((option) => !option.disabled);
              open(
                select,
                event.key === "Home" ? enabled[0]?.value : event.key === "End" ? enabled.at(-1)?.value : null
              );
            }
          });
        }
        trigger.disabled = select.disabled;
        const label = select.getAttribute("aria-label");
        const value = select.selectedOptions[0]?.textContent || "";
        trigger.setAttribute("aria-label", `${label}: ${value}`);
        trigger.innerHTML = `<span>${escapeHtml(value)}</span>${chevron}`;
      }
      if (snapshot && replaced) {
        const row = [...host.querySelectorAll("[data-plan-id]")].find((node) => node.dataset.planId === snapshot.plan);
        const select = [...(row?.querySelectorAll("select[data-role]") || [])].find(
          (node) => node.dataset.role === snapshot.role
        );
        if (select) {
          controls.get(select)?.focus({ preventScroll: true });
          if (snapshot.open) open(select);
        }
      }
    }
    return { capture, sync };
  }
  return { createManager };
});


// SOURCE: src/ui/upgrade-view.js
(function (root, factory) {
  const api = factory(
    typeof module !== "undefined" && module.exports ? require("./shrine-effects.js") : root.MwiGuildShrineEffects,
    typeof module !== "undefined" && module.exports ? require("./shrine-picker.js") : root.MwiGuildShrinePicker
  );
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildCreditUpgradeView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (effectApi, pickerApi) {
  "use strict";

  function createUpgradeView(dependencies) {
    const {
      core,
      state,
      t,
      ui,
      escapeHtml,
      resolveItemName,
      simpleItemName,
      titleCase,
      formatNumber,
      iconMarkup,
      marketItemIconMarkup,
      guildBuildingSpriteBaseHref,
      guildBuildingIconMarkup,
      itemQuantity,
      creditQuantity,
      snapshotOrderBook,
      allConversions,
      CREDIT_TYPES,
      GUILD_TOKEN_CREDIT_CONVERSIONS,
      GUILD_TOKEN_BUDGET_SNAP_PERCENTAGES,
      GUILD_TOKEN_BUDGET_SNAP_THRESHOLD_PERCENTAGE,
      GUILD_SHRINE_NAME_KEYS,
      SHOW_ALL_CREDIT_TOKEN_TOGGLE,
      guildShrineLevelRecordKey,
      persistPluginUiState,
      updateRenderedMarkup,
      hydrateBridgeData,
      extractItemDetailsFromReact,
      hydrateLocalInitData,
      loadSnapshot,
      refreshOfficialItemNameCatalog,
      scheduleShrineGuide,
      scheduleGuildExchangeAdvisor,
      guildTokenBudgetRefreshTask
    } = dependencies;

    const effects = effectApi.createFormatter({ core, t, ui });
    const pickers = new WeakMap();

    function guildBuffEntries() {
      hydrateBridgeData();
      extractItemDetailsFromReact();
      hydrateLocalInitData();
      const details = Array.isArray(state.guildBuffDetails)
        ? state.guildBuffDetails.map((detail) => [detail && (detail.hrid || detail.guildBuffHrid), detail])
        : Object.entries(state.guildBuffDetails || {});
      return details
        .map(([hrid, detail]) => ({ hrid: (detail && (detail.hrid || detail.guildBuffHrid)) || hrid, detail }))
        .filter(({ hrid, detail }) => hrid && detail && detail.levelCosts)
        .map(({ hrid, detail }) => ({
          hrid,
          detail,
          maxLevel: Array.isArray(detail.levelCosts)
            ? detail.levelCosts.length - 1
            : Math.max(...Object.keys(detail.levelCosts).map(Number).filter(Number.isSafeInteger))
        }))
        .filter(({ maxLevel }) => Number.isSafeInteger(maxLevel) && maxLevel > 0)
        .sort((left, right) =>
          guildBuffLabel(left.detail, left.hrid).localeCompare(guildBuffLabel(right.detail, right.hrid), ui().locale)
        );
    }

    function guildBuffLabel(detail, fallbackHrid) {
      const shrineKey = GUILD_SHRINE_NAME_KEYS[detail && detail.shrineHrid];
      const shrineName = shrineKey
        ? t(shrineKey)
        : titleCase(simpleItemName((detail && detail.shrineHrid) || fallbackHrid));
      const domain =
        detail && detail.isCombat === true
          ? t("domainCombat")
          : detail && detail.isCombat === false
            ? t("domainLife")
            : "";
      return domain ? t("shrineWithDomain", { shrine: shrineName, domain }) : shrineName;
    }

    function itemNameForMaterial(itemHrid) {
      const details = Array.isArray(state.itemDetails)
        ? state.itemDetails.map((detail) => [detail && (detail.itemHrid || detail.hrid), detail])
        : Object.entries(state.itemDetails || {});
      const detail = details.find(([hrid]) => hrid === itemHrid);
      return resolveItemName(itemHrid, detail && detail[1] && detail[1].name);
    }

    function materialOrder(left, right) {
      if (left.itemHrid === "/items/guild_token") return -1;
      if (right.itemHrid === "/items/guild_token") return 1;
      const leftCredit = CREDIT_TYPES.findIndex(([hrid]) => hrid === left.itemHrid);
      const rightCredit = CREDIT_TYPES.findIndex(([hrid]) => hrid === right.itemHrid);
      if (leftCredit >= 0 && rightCredit >= 0) return leftCredit - rightCredit;
      if (leftCredit >= 0) return -1;
      if (rightCredit >= 0) return 1;
      return itemNameForMaterial(left.itemHrid).localeCompare(itemNameForMaterial(right.itemHrid), ui().locale);
    }

    function inventoryItemCounts() {
      hydrateBridgeData();
      extractItemDetailsFromReact();
      hydrateLocalInitData();
      const counts = Object.create(null);
      for (const item of state.characterItems || []) {
        if (!item || item.itemLocationHrid !== "/item_locations/inventory") continue;
        const count = Number(item.count);
        if (!item.itemHrid || !Number.isFinite(count) || count <= 0) continue;
        counts[item.itemHrid] = (counts[item.itemHrid] || 0) + count;
      }
      return counts;
    }

    function bestCreditConversions(targetCreditsByHrid) {
      return Object.fromEntries(
        CREDIT_TYPES.map(([creditItemHrid]) => {
          const targetCredits = targetCreditsByHrid ? Number(targetCreditsByHrid[creditItemHrid]) : 1;
          if (!Number.isSafeInteger(targetCredits) || targetCredits <= 0) return [creditItemHrid, null];
          const conversions = allConversions(creditItemHrid);
          const books = Object.fromEntries(
            conversions.map((conversion) => [conversion.itemHrid, snapshotOrderBook(conversion.itemHrid)])
          );
          return [
            creditItemHrid,
            core.rankConversions(conversions, books, targetCredits).find((row) => row.status === "ok") || null
          ];
        })
      );
    }

    function bestCreditUnitCosts() {
      const tokenCreditTargets = Object.fromEntries(
        GUILD_TOKEN_CREDIT_CONVERSIONS.map((rule) => [rule.creditItemHrid, rule.creditCount])
      );
      return Object.fromEntries(
        Object.entries(bestCreditConversions(tokenCreditTargets)).map(([creditItemHrid, best]) => [
          creditItemHrid,
          best ? best.costPerCredit : null
        ])
      );
    }

    function bestCreditMaterialPlans(estimate) {
      const missingCredits = Object.fromEntries(
        ((estimate && estimate.rows) || []).map((row) => [row.itemHrid, row.remainingMissing ?? row.missing])
      );
      return bestCreditConversions(missingCredits);
    }

    function currentGuildBuffLevel(entry) {
      const stored = Array.isArray(state.guildBuffLevels)
        ? state.guildBuffLevels.find((value) => value && (value.guildBuffHrid || value.hrid) === entry.hrid)
        : state.guildBuffLevels && state.guildBuffLevels[entry.hrid];
      const value = stored && typeof stored === "object" ? (stored.level ?? stored.currentLevel) : stored;
      const level = Number(value);
      return Number.isSafeInteger(level) && level >= 0 ? Math.min(level, entry.maxLevel) : 0;
    }

    function shrineLevelValue(value) {
      const raw =
        value && typeof value === "object"
          ? (value.level ?? value.currentLevel ?? value.guildBuildingLevel ?? value.buildingLevel)
          : value;
      const level = Number(raw);
      return Number.isSafeInteger(level) && level >= 0 ? level : null;
    }

    function shrineIdentityValues(record, fallbackHrid) {
      const values = [fallbackHrid];
      if (!record || typeof record !== "object") return values;
      for (const key of [
        "guildShrineHrid",
        "shrineHrid",
        "guildBuildingHrid",
        "hrid",
        "id",
        "guildBuffHrid",
        "name",
        "displayName",
        "label"
      ]) {
        if (typeof record[key] === "string") values.push(record[key]);
      }
      return values;
    }

    function guildShrineDetailFor(record, fallbackHrid) {
      const source = state.guildShrineDetails;
      const entries = Array.isArray(source)
        ? source.map((detail, index) => [guildShrineLevelRecordKey(detail, index), detail])
        : Object.entries(source || {});
      const identityValues = new Set(shrineIdentityValues(record, fallbackHrid));
      for (const [detailKey, detail] of entries) {
        const detailValues = shrineIdentityValues(detail, detailKey);
        if (detailValues.some((value) => identityValues.has(value))) return detail;
      }
      return null;
    }

    function shrineLevelRecordMatches(record, fallbackHrid, shrineHrid) {
      const shrineKey = String(shrineHrid || "")
        .split("/")
        .pop()
        .toLowerCase();
      if (!shrineKey) return false;
      const detail = guildShrineDetailFor(record, fallbackHrid);
      const candidates = [...shrineIdentityValues(record, fallbackHrid), ...shrineIdentityValues(detail, "")].filter(
        (value) => typeof value === "string"
      );
      return candidates.some((value) => {
        const normalized = value.toLowerCase();
        // Older and newer game payloads use both `tempo_shrine` and simply
        // `tempo` as guild-building IDs. This value is only inspected inside
        // the captured guild-shrine/building maps, so an exact HRID segment is
        // sufficient and avoids silently omitting valid shrine levels.
        return normalized === shrineHrid || new RegExp(`(^|[/_-])${shrineKey}([/_-]|$)`).test(normalized);
      });
    }

    function guildShrineLevelByHrid(shrineHrid) {
      const source = state.guildShrineLevels;
      const entries = Array.isArray(source)
        ? source.map((record) => [
            record && (record.guildShrineHrid || record.shrineHrid || record.guildBuildingHrid || record.hrid),
            record
          ])
        : Object.entries(source || {});
      for (const [fallbackHrid, record] of entries) {
        if (!shrineLevelRecordMatches(record, fallbackHrid, shrineHrid)) continue;
        const level = shrineLevelValue(record);
        if (level !== null) return level;
      }
      // The game only includes built (non-zero) guild shrine buildings in this
      // map. Once a guild-building snapshot exists, a missing shrine is the
      // game's representation of level 0, not an unreadable level.
      return source ? 0 : null;
    }

    function guildShrineTargetLevels(entries) {
      const targets = Object.create(null);
      for (const entry of entries) {
        const shrineHrid = entry && entry.detail && entry.detail.shrineHrid;
        if (!shrineHrid || Object.hasOwn(targets, shrineHrid)) continue;
        const level = guildShrineLevelByHrid(shrineHrid);
        if (level !== null) targets[shrineHrid] = Math.min(level, entry.maxLevel);
      }
      return targets;
    }

    function isCombatGuildBuff(entry) {
      return entry && entry.detail && entry.detail.isCombat === true;
    }

    function applyGuildShrineTargets(entries, domain) {
      const combat = domain === "combat";
      const requestedDomainEntries = entries.filter((entry) => isCombatGuildBuff(entry) === combat);
      const { eligibleEntries: domainEntries, preservedPlans } = core.selectGuildShrineAutofillScope({
        entries,
        plans: state.upgradePlans,
        domain,
        excludedGuildBuffHrids: state.guildShrineAutofillExcludedBuffHrids
      });
      if (!requestedDomainEntries.length) return false;
      if (!domainEntries.length) {
        state.upgradePresetNotice = t("guildAutofillAllExcluded", {
          domain: combat ? t("domainCombat") : t("domainLife")
        });
        return false;
      }
      const targets = guildShrineTargetLevels(domainEntries);
      if (!domainEntries.length || domainEntries.some((entry) => !Object.hasOwn(targets, entry.detail.shrineHrid)))
        return false;
      const planned = domainEntries
        .map((entry) => {
          const startLevel = currentGuildBuffLevel(entry);
          const targetLevel = targets[entry.detail.shrineHrid];
          return targetLevel > startLevel
            ? { id: `plan-${state.nextUpgradePlanId++}`, guildBuffHrid: entry.hrid, startLevel, targetLevel }
            : null;
        })
        .filter(Boolean);
      state.upgradePlans = [...preservedPlans, ...planned];
      const targetDomain = combat ? t("domainCombat") : t("domainLife");
      state.upgradePresetNotice = planned.length
        ? t("guildTargetApplied", { domain: targetDomain, count: formatNumber(planned.length) })
        : t("guildTargetComplete", { domain: targetDomain });
      return true;
    }

    function normalizeUpgradePlan(plan, entries) {
      const entry = entries.find((candidate) => candidate.hrid === plan.guildBuffHrid);
      if (!entry) return null;
      const currentLevel = currentGuildBuffLevel(entry);
      const rawStart = Number(plan.startLevel);
      const startLevel =
        Number.isSafeInteger(rawStart) && rawStart >= 0 && rawStart < entry.maxLevel ? rawStart : currentLevel;
      const rawTarget = Number(plan.targetLevel);
      const targetLevel =
        Number.isSafeInteger(rawTarget) && rawTarget > startLevel && rawTarget <= entry.maxLevel
          ? rawTarget
          : Math.min(startLevel + 1, entry.maxLevel);
      return { ...plan, guildBuffHrid: entry.hrid, startLevel, targetLevel };
    }

    function addGuildUpgradePlan(entries) {
      const plannedHrids = new Set(state.upgradePlans.map((plan) => plan.guildBuffHrid));
      const entry = entries.find(
        (candidate) => !plannedHrids.has(candidate.hrid) && currentGuildBuffLevel(candidate) < candidate.maxLevel
      );
      if (!entry) return false;
      const startLevel = currentGuildBuffLevel(entry);
      state.upgradePlans.push({
        id: `plan-${state.nextUpgradePlanId++}`,
        guildBuffHrid: entry.hrid,
        startLevel,
        targetLevel: startLevel + 1
      });
      state.upgradePresetNotice = "";
      return true;
    }

    function clearGuildUpgradePlans() {
      state.upgradePlans = [];
      state.upgradePresetNotice = t("plansCleared");
    }

    function removeGuildUpgradePlan(planId) {
      const previousLength = state.upgradePlans.length;
      state.upgradePlans = state.upgradePlans.filter((plan) => plan.id !== planId);
      if (state.upgradePlans.length === previousLength) return false;
      const removedLastPlan = state.upgradePlans.length === 0;
      state.upgradePresetNotice = removedLastPlan ? t("plansCleared") : "";
      return true;
    }

    function ensureGuildUpgradePlans(entries) {
      state.upgradePlans = state.upgradePlans.map((plan) => normalizeUpgradePlan(plan, entries)).filter(Boolean);
      persistPluginUiState();
    }

    function levelOptionMarkup(start, end, selected) {
      return Array.from({ length: Math.max(end - start + 1, 0) }, (_, index) => start + index)
        .map(
          (level) =>
            `<option value="${level}" ${level === selected ? "selected" : ""}>${escapeHtml(t("level", { level: formatNumber(level) }))}</option>`
        )
        .join("");
    }

    function updateGuildShrineTargetActions(panel, entries) {
      const targets = guildShrineTargetLevels(entries);
      const summaries = [];
      const excludedDomainNotices = [];
      for (const domain of ["life", "combat"]) {
        const combat = domain === "combat";
        const domainLabel = combat ? t("domainCombat") : t("domainLife");
        const domainEntries = entries.filter((entry) => isCombatGuildBuff(entry) === combat);
        const { eligibleEntries } = core.selectGuildShrineAutofillScope({
          entries,
          plans: [],
          domain,
          excludedGuildBuffHrids: state.guildShrineAutofillExcludedBuffHrids
        });
        const eligibleTargets = guildShrineTargetLevels(eligibleEntries);
        const ready =
          eligibleEntries.length > 0 &&
          eligibleEntries.every((entry) => Object.hasOwn(eligibleTargets, entry.detail.shrineHrid));
        const missing = Array.from(
          new Set(
            eligibleEntries
              .filter((entry) => !Object.hasOwn(eligibleTargets, entry.detail.shrineHrid))
              .map((entry) => {
                const nameKey = GUILD_SHRINE_NAME_KEYS[entry.detail.shrineHrid];
                return nameKey ? t(nameKey) : entry.detail.shrineHrid;
              })
          )
        );
        const button = panel.querySelector(`[data-role="set-guild-shrine-target"][data-domain="${domain}"]`);
        const excludedDomainNotice =
          !eligibleEntries.length && domainEntries.length
            ? t("guildAutofillDomainExcluded", { domain: domainLabel })
            : "";
        if (excludedDomainNotice) excludedDomainNotices.push(excludedDomainNotice);
        if (button) {
          button.disabled = !ready;
          button.title =
            excludedDomainNotice ||
            (ready ? "" : t("targetButtonMissing", { missing: missing.join(ui().locale === "zh-CN" ? "、" : ", ") }));
        }
        const count = Object.keys(targets).filter((shrineHrid) =>
          domainEntries.some((entry) => entry.detail.shrineHrid === shrineHrid)
        ).length;
        const missingText = missing.length
          ? t("targetSummaryMissing", { missing: missing.join(ui().locale === "zh-CN" ? "、" : ", ") })
          : "";
        summaries.push(
          t("targetSummary", {
            domain: domainLabel,
            count: formatNumber(count),
            total: formatNumber(domainEntries.length),
            missing: missingText
          })
        );
      }
      const status = panel.querySelector('[data-role="guild-shrine-target-status"]');
      if (status) {
        const levelStatus = state.guildShrineLevels
          ? t("shrineLevelsRead", { summaries: summaries.join(" · ") })
          : t("shrineLevelsReading");
        status.textContent = [levelStatus, ...excludedDomainNotices].join(" ");
      }
    }

    function renderPlanMaterials(result) {
      if (result.status !== "ok")
        return `<span class="mwi-shrine-warning">${escapeHtml(t(result.status === "missing_cost" ? "missingLevelCost" : "invalidLevels", { level: result.missingLevel }))}</span>`;
      if (!result.totals.length) return escapeHtml(t("shrineNoMaterials"));
      return `<ul class="mwi-shrine-materials">${result.totals
        .slice()
        .sort(materialOrder)
        .map(
          (item) =>
            `<li>${iconMarkup(item.itemHrid, itemNameForMaterial(item.itemHrid))}<span>${escapeHtml(itemNameForMaterial(item.itemHrid))}</span><strong>${escapeHtml(formatNumber(item.count))}</strong></li>`
        )
        .join("")}</ul>`;
    }

    function renderPlanEffects(preview) {
      if (!preview.effects.length)
        return `<p class="mwi-shrine-muted">${escapeHtml(t("shrineEffectsUnavailable"))}</p>`;
      return `<dl class="mwi-shrine-effect-comparison">${preview.effects.map((effect) => `<div><dt>${escapeHtml(effects.name(effect))}</dt><dd><span>${escapeHtml(effects.value(effect, effect.start))}</span><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 8h11M9 4l4 4-4 4"/></svg><strong>${escapeHtml(effects.value(effect, effect.target))}</strong><small>${escapeHtml(t("shrineGain", { value: effects.value(effect, effect.gain) }))}</small></dd></div>`).join("")}</dl>`;
    }

    function renderGuildUpgradePlans(panel, entries) {
      const list = panel.querySelector('[data-role="upgrade-plan-list"]');
      let picker = pickers.get(list);
      if (!picker) {
        picker = pickerApi.createManager(list, escapeHtml);
        pickers.set(list, picker);
      }
      const pickerSnapshot = picker.capture();
      const plannedHrids = new Set(state.upgradePlans.map((plan) => plan.guildBuffHrid));
      const openPlans = new Set(
        [...list.querySelectorAll("details[data-shrine-steps][open]")].map(
          (node) => node.closest("[data-plan-id]").dataset.planId
        )
      );
      const active = list.ownerDocument.activeElement;
      const focusedPlan = list.contains(active) ? active.closest("[data-plan-id]")?.dataset.planId : null;
      const focusedRole = active?.dataset?.role;
      const focusedSteps = active?.matches("summary[data-shrine-steps-summary]");
      const sprite = guildBuildingSpriteBaseHref?.() || "";
      const plansMarkup = state.upgradePlans
        .map((plan) => {
          const entry = entries.find((candidate) => candidate.hrid === plan.guildBuffHrid);
          if (!entry) return "";
          const buffOptions = [false, true]
            .map(
              (combat) =>
                `<optgroup label="${escapeHtml(t(combat ? "domainCombat" : "domainLife"))}">${entries
                  .filter((candidate) => isCombatGuildBuff(candidate) === combat)
                  .map(
                    (candidate) =>
                      `<option value="${escapeHtml(candidate.hrid)}" ${candidate.hrid === plan.guildBuffHrid ? "selected" : ""} ${candidate.hrid !== plan.guildBuffHrid && (plannedHrids.has(candidate.hrid) || currentGuildBuffLevel(candidate) >= candidate.maxLevel) ? "disabled" : ""}>${escapeHtml(GUILD_SHRINE_NAME_KEYS[candidate.detail.shrineHrid] ? t(GUILD_SHRINE_NAME_KEYS[candidate.detail.shrineHrid]) : guildBuffLabel(candidate.detail, candidate.hrid))}</option>`
                  )
                  .join("")}</optgroup>`
            )
            .join("");
          const shrineHrid = entry.detail.shrineHrid || "";
          const cap = guildShrineLevelByHrid(shrineHrid);
          const preview = core.guildBuffUpgradePreview(entry.detail, plan.startLevel, plan.targetLevel);
          const knownLevel = state.guildBuffLevels != null;
          const current = knownLevel ? formatNumber(currentGuildBuffLevel(entry)) : t("notRead");
          const aboveCap = cap !== null && plan.targetLevel > cap;
          const icon = guildBuildingIconMarkup?.({ hrid: shrineHrid }, sprite) || "";
          const title = guildBuffLabel(entry.detail, entry.hrid);
          const collapsed = plan.collapsed === true;
          const bodyId = `mwi-shrine-plan-body-${plan.id}`;
          return `<article class="mwi-upgrade-plan" data-plan-id="${escapeHtml(plan.id)}" data-guild-buff-hrid="${escapeHtml(entry.hrid)}" data-shrine-hrid="${escapeHtml(shrineHrid)}" data-domain="${isCombatGuildBuff(entry) ? "combat" : "life"}" aria-label="${escapeHtml(title)}">
          <div class="mwi-shrine-plan-header"><span class="mwi-shrine-plan-icon" aria-hidden="true">${icon}</span><div class="mwi-upgrade-plan-shrine"><span class="mwi-upgrade-field-label">${escapeHtml(t("shrine"))} · ${escapeHtml(t(isCombatGuildBuff(entry) ? "domainCombat" : "domainLife"))}</span><select data-role="plan-buff" aria-label="${escapeHtml(t("shrine"))}">${buffOptions}</select></div><button class="mwi-remove-plan" data-role="remove-plan" type="button" title="${escapeHtml(t("removePlan"))}" aria-label="${escapeHtml(t("shrineRemoveNamed", { shrine: title }))}"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8"/></svg></button></div>
          <div class="mwi-shrine-collapse-bar"><span>${escapeHtml(t("shrineLevelRange", { start: plan.startLevel, target: plan.targetLevel }))}</span><button type="button" data-role="toggle-plan" aria-expanded="${!collapsed}" aria-controls="${escapeHtml(bodyId)}" aria-label="${escapeHtml(t(collapsed ? "shrineExpandNamed" : "shrineCollapseNamed", { shrine: title }))}"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>${escapeHtml(t(collapsed ? "shrineExpand" : "shrineCollapse"))}</button></div>
          <div class="mwi-shrine-plan-body" id="${escapeHtml(bodyId)}"${collapsed ? " hidden" : ""}>
          <p class="mwi-shrine-level-status">${escapeHtml(t("shrineLevelStatus", { current, cap: cap === null ? t("notRead") : formatNumber(cap) }))}</p>
          <div class="mwi-shrine-level-controls"><div class="mwi-upgrade-plan-start"><span class="mwi-upgrade-field-label">${escapeHtml(t("startLevel"))}</span><select data-role="plan-start" aria-label="${escapeHtml(t("startLevel"))}">${levelOptionMarkup(0, entry.maxLevel - 1, plan.startLevel)}</select></div><span class="mwi-upgrade-level-arrow" aria-hidden="true">→</span><div class="mwi-upgrade-plan-target"><span class="mwi-upgrade-field-label">${escapeHtml(t("targetLevel"))}</span><select data-role="plan-target" aria-label="${escapeHtml(t("targetLevel"))}">${levelOptionMarkup(plan.startLevel + 1, entry.maxLevel, plan.targetLevel)}</select></div><div class="mwi-shrine-target-actions"><button type="button" data-role="shrine-target-next">${escapeHtml(t("shrineNextLevel"))}</button><button type="button" data-role="shrine-target-cap" data-target-level="${cap === null ? "" : Math.min(cap, entry.maxLevel)}"${cap === null || cap <= plan.startLevel ? " disabled" : ""}>${escapeHtml(t("shrineToGuildCap"))}</button></div></div>
          ${!knownLevel ? `<p class="mwi-shrine-warning">${escapeHtml(t("shrineStartAssumed"))}</p>` : ""}
          ${cap === null ? `<p class="mwi-shrine-warning">${escapeHtml(t("shrineCapUnknown"))}</p>` : aboveCap ? `<p class="mwi-shrine-warning" data-shrine-cap-warning>${escapeHtml(t("shrineAboveCap", { level: formatNumber(cap) }))}</p>` : ""}
          <section class="mwi-shrine-plan-effects" aria-label="${escapeHtml(t("shrineEffectComparison"))}"><h4>${escapeHtml(t("shrineEffectComparison"))}<small>${escapeHtml(t("shrineLevelRange", { start: plan.startLevel, target: plan.targetLevel }))}</small></h4>${renderPlanEffects(preview)}</section>
          <section class="mwi-shrine-plan-cost" aria-label="${escapeHtml(t("shrineRangeCost"))}"><h4>${escapeHtml(t("shrineRangeCost"))}</h4>${renderPlanMaterials(preview)}</section>
          <details class="mwi-shrine-steps" data-shrine-steps${openPlans.has(plan.id) ? " open" : ""}><summary data-shrine-steps-summary>${escapeHtml(t("shrineSteps", { count: preview.steps.length }))}</summary><ol>${preview.steps.map((step) => `<li data-shrine-step="${step.level}"><div class="mwi-shrine-step-heading"><strong>${escapeHtml(t("shrineStepLevel", { start: step.level - 1, target: step.level }))}</strong><span>${step.effects.length ? step.effects.map((effect) => escapeHtml(`${effects.name(effect)} ${effects.value(effect, effect.value)}`)).join(" · ") : escapeHtml(t("shrineEffectsUnavailable"))}</span></div>${renderPlanMaterials({ status: "ok", totals: step.totals })}</li>`).join("")}</ol>${preview.status !== "ok" ? renderPlanMaterials(preview) : ""}</details>
          </div>
        </article>`;
        })
        .join("");
      const replaced = updateRenderedMarkup(list, plansMarkup);
      picker.sync(
        (select, option) => {
          if (select.dataset.role !== "plan-buff") return {};
          const candidate = entries.find((item) => item.hrid === option.value);
          if (!candidate) return {};
          return {
            icon: guildBuildingIconMarkup?.({ hrid: candidate.detail.shrineHrid }, sprite) || "",
            description: effects.summary(candidate.detail),
            reason: option.disabled ? t(plannedHrids.has(candidate.hrid) ? "shrineAlreadyPlanned" : "shrineMaxed") : ""
          };
        },
        pickerSnapshot,
        replaced
      );
      if (focusedPlan && (focusedRole || focusedSteps)) {
        const row = [...list.querySelectorAll("[data-plan-id]")].find((node) => node.dataset.planId === focusedPlan);
        const control = focusedSteps
          ? row?.querySelector("summary[data-shrine-steps-summary]")
          : [...(row?.querySelectorAll("[data-role]") || [])].find((node) => node.dataset.role === focusedRole);
        control?.focus({ preventScroll: true });
      }
      const count = panel.querySelector('[data-role="upgrade-plan-count"]');
      if (count) count.textContent = t("selectedUpgradePlanCount", { count: formatNumber(state.upgradePlans.length) });
      updateGuildShrineTargetActions(panel, entries);
    }

    function guildTokenCreditSelectionState() {
      const selectedCount = CREDIT_TYPES.reduce(
        (count, [hrid]) => count + (state.guildTokenCreditHrids.has(hrid) ? 1 : 0),
        0
      );
      return {
        selectedCount,
        allSelected: selectedCount === CREDIT_TYPES.length,
        partiallySelected: selectedCount > 0 && selectedCount < CREDIT_TYPES.length
      };
    }

    function updateGuildTokenCreditPlanButton(panel) {
      const button = panel.querySelector('[data-role="toggle-guild-token-credit-plan"]');
      if (!button) return;
      const selection = guildTokenCreditSelectionState();
      const activeState = selection.allSelected ? "true" : selection.partiallySelected ? "mixed" : "false";
      button.dataset.active = activeState;
      button.setAttribute("aria-pressed", activeState);
      const indicator = button.querySelector(".mwi-token-credit-plan-indicator");
      if (indicator) indicator.textContent = selection.allSelected ? "✓" : selection.partiallySelected ? "−" : "";
    }

    function renderGuildTokenCreditPlanToggle() {
      if (!SHOW_ALL_CREDIT_TOKEN_TOGGLE) return "";
      const selection = guildTokenCreditSelectionState();
      const activeState = selection.allSelected ? "true" : selection.partiallySelected ? "mixed" : "false";
      const indicator = selection.allSelected ? "✓" : selection.partiallySelected ? "−" : "";
      return `<button class="mwi-token-credit-plan-toggle" data-role="toggle-guild-token-credit-plan" data-active="${activeState}" type="button" aria-pressed="${activeState}"><span class="mwi-token-credit-plan-indicator" aria-hidden="true">${indicator}</span><span class="mwi-token-credit-plan-copy"><strong>${escapeHtml(t("useGuildTokensForMissingCredits"))}</strong></span></button>`;
    }

    function renderGuildTokenBudgetControl() {
      const snapMarks = GUILD_TOKEN_BUDGET_SNAP_PERCENTAGES.map(
        (percentage) => `<i data-percentage="${percentage}" style="--mwi-snap-position:${percentage}%"></i>`
      ).join("");
      return `<section class="mwi-token-budget" data-role="guild-token-budget-control"><div class="mwi-token-budget-heading"><strong>${escapeHtml(t("autoGuildTokenBudget"))}</strong></div><div class="mwi-token-budget-inputs"><span class="mwi-token-budget-range-wrap"><input data-role="guild-token-budget-range" type="range" min="0" max="0" step="1" value="0" disabled aria-label="${escapeHtml(t("autoGuildTokenBudget"))}"><span class="mwi-token-budget-snap-points" aria-hidden="true">${snapMarks}</span></span><output class="mwi-token-budget-percent" data-role="guild-token-budget-percent" aria-live="polite">0%</output><label><input data-role="guild-token-budget-number" type="number" min="0" max="0" step="1" value="0" disabled><span>${escapeHtml(t("guildTokens"))}</span></label></div><span class="mwi-token-budget-available" data-role="guild-token-budget-available">${escapeHtml(t("autoGuildTokenBudgetAvailable", { count: "0" }))}</span></section>`;
    }

    function updateGuildTokenBudgetPercentage(panel, value, max, snappedTo = null) {
      const range = panel.querySelector('[data-role="guild-token-budget-range"]');
      const output = panel.querySelector('[data-role="guild-token-budget-percent"]');
      if (!range || !output) return;
      const percentage = core.guildTokenBudgetPercentage(value, max);
      output.value = `${percentage}%`;
      output.textContent = `${percentage}%`;
      output.dataset.snapped = String(snappedTo !== null);
      range.setAttribute("aria-valuetext", `${percentage}% · ${formatNumber(value)} ${t("guildTokens")}`);
    }

    function updateGuildTokenBudgetControl(panel, estimate, hasInventory) {
      const range = panel.querySelector('[data-role="guild-token-budget-range"]');
      const number = panel.querySelector('[data-role="guild-token-budget-number"]');
      const available = panel.querySelector('[data-role="guild-token-budget-available"]');
      if (!range || !number || !available) return;
      const max =
        hasInventory && estimate ? Math.max(0, Math.floor(Number(estimate.autoGuildTokenBudgetAvailable) || 0)) : 0;
      const effective = state.autoGuildTokenBudget === null ? max : Math.min(max, state.autoGuildTokenBudget);
      for (const input of [range, number]) {
        input.max = String(max);
        input.value = String(effective);
        input.disabled = !hasInventory;
      }
      const effectivePercentage = core.guildTokenBudgetPercentage(effective, max);
      const snappedTo =
        range.dataset.dragging === "true" && GUILD_TOKEN_BUDGET_SNAP_PERCENTAGES.includes(effectivePercentage)
          ? effectivePercentage
          : null;
      updateGuildTokenBudgetPercentage(panel, effective, max, snappedTo);
      available.textContent = t("autoGuildTokenBudgetAvailable", { count: formatNumber(max) });
    }

    function setGuildTokenBudget(panel, rawValue, options = {}) {
      const range = panel.querySelector('[data-role="guild-token-budget-range"]');
      const number = panel.querySelector('[data-role="guild-token-budget-number"]');
      if (!range || !number || rawValue === "") return;
      const max = Math.max(0, Number(range.max) || 0);
      const resolved = options.snap
        ? core.snapGuildTokenBudget(rawValue, max, {
            snapPercentages: GUILD_TOKEN_BUDGET_SNAP_PERCENTAGES,
            thresholdPercentage: GUILD_TOKEN_BUDGET_SNAP_THRESHOLD_PERCENTAGE
          })
        : { value: Math.min(max, Math.max(0, Math.floor(Number(rawValue) || 0))), snappedTo: null };
      const value = resolved.value;
      state.autoGuildTokenBudget = value;
      range.value = String(value);
      number.value = String(value);
      updateGuildTokenBudgetPercentage(panel, value, max, resolved.snappedTo);
      persistPluginUiState();
      guildTokenBudgetRefreshTask.schedule(panel);
    }

    function renderUpgradeCostText(gold, guildTokens, showZeroGuildTokens) {
      const parts = [`${core.formatCompactCost(gold)} ${t("gold")}`];
      if (guildTokens > 0 || showZeroGuildTokens) parts.push(`${formatNumber(guildTokens)} ${t("guildTokens")}`);
      return parts.join(" + ");
    }

    function renderUpgradeCostSummary(estimate, hasInventory) {
      if (!estimate)
        return `<div class="mwi-upgrade-cost-summary mwi-upgrade-cost-unavailable">${escapeHtml(t("noSnapshotEstimate"))}</div>`;
      const partial = estimate.status !== "ok";
      const missingNames = estimate.unpricedItemHrids
        .map(itemNameForMaterial)
        .join(ui().locale === "zh-CN" ? "、" : ", ");
      const totalLabel = partial ? t("partialEstimatedCost") : t("estimatedTotalCost");
      const missingLabel = partial ? t("partialAfterInventory") : t("afterInventory");
      const inventoryNote = hasInventory
        ? ""
        : `<div class="mwi-upgrade-cost-note">${escapeHtml(t("inventoryUnavailable"))}</div>`;
      const priceNote = partial
        ? `<div class="mwi-upgrade-cost-note">${escapeHtml(t("noCreditPrice", { items: missingNames }))}</div>`
        : "";
      const tokenExchangeNote =
        estimate.guildTokenCreditExchangeRequired > 0
          ? `<div class="mwi-upgrade-cost-note mwi-upgrade-token-note">${escapeHtml(t("guildTokenCreditPlanSummary", { count: formatNumber(estimate.guildTokenCreditExchangeRequired) }))}</div>`
          : "";
      const autoTokenNote =
        estimate.autoGuildTokenCreditExchangeUsed > 0
          ? `<div class="mwi-upgrade-cost-note mwi-upgrade-auto-token-note">${escapeHtml(t("autoGuildTokenPlanSummary", { count: formatNumber(estimate.autoGuildTokenCreditExchangeUsed) }))}</div>`
          : "";
      return `<section class="mwi-upgrade-cost-summary"><div class="mwi-upgrade-cost-title">${escapeHtml(t("costSummary"))}</div><div><span>${escapeHtml(totalLabel)}</span><strong>${renderUpgradeCostText(estimate.totalGold, estimate.guildTokensRequired)}</strong></div><div><span>${escapeHtml(missingLabel)}</span><strong>${renderUpgradeCostText(estimate.missingGold, estimate.guildTokensMissing, estimate.guildTokenCreditExchangeRequired > 0)}</strong></div>${tokenExchangeNote}${autoTokenNote}${inventoryNote}${priceNote}</section>`;
    }

    function renderGuildTokenMaterialPlan(exchange, hasInventory, materialInventory, automatic) {
      const requiredGuildTokens = automatic ? exchange.spentGuildTokens : exchange.requiredGuildTokens;
      const detail = automatic
        ? t("autoGuildTokenCoverage", { count: formatNumber(exchange.coveredCredits) })
        : t("backpackInventory", {
            count: hasInventory
              ? formatNumber(Number(materialInventory && materialInventory["/items/guild_token"]) || 0)
              : t("notRead")
          });
      const needLabel = automatic ? t("autoGuildTokenExchangeNeeds") : t("guildTokenExchangeNeeds");
      return `<div class="mwi-material-plan-item" data-guide-item-hrid="/items/guild_token"><span class="mwi-material-plan-icon">${iconMarkup("/items/guild_token", itemNameForMaterial("/items/guild_token"))}</span><span><b>${escapeHtml(itemNameForMaterial("/items/guild_token"))}</b><small>${escapeHtml(detail)}</small></span></div><div class="mwi-material-plan-need"><small>${escapeHtml(needLabel)}</small><strong>${formatNumber(requiredGuildTokens)}</strong></div><span class="mwi-material-plan-rate">${escapeHtml(t("exchangeRate", { items: `${formatNumber(exchange.guildTokenCount)} ${t("guildTokens")}`, credits: creditQuantity(exchange.creditCount) }))}</span>`;
    }

    function renderOptimalMaterialPlan(plan, hasInventory, materialInventory) {
      if (!plan)
        return `<div class="mwi-material-plan-unavailable">${escapeHtml(t("optimalExchangeUnavailable"))}</div>`;
      return `<div class="mwi-material-plan-item" data-guide-item-hrid="${escapeHtml(plan.itemHrid)}"><span class="mwi-material-plan-icon">${marketItemIconMarkup(plan.itemHrid, itemNameForMaterial(plan.itemHrid))}</span><span><b>${escapeHtml(itemNameForMaterial(plan.itemHrid))}</b><small>${escapeHtml(t("backpackInventory", { count: hasInventory ? formatNumber(Number(materialInventory && materialInventory[plan.itemHrid]) || 0) : t("notRead") }))}</small></span></div><div class="mwi-material-plan-need"><small>${escapeHtml(t("optimalExchangeNeeds"))}</small><strong>${formatNumber(plan.requiredItems)}</strong></div><span class="mwi-material-plan-rate">${escapeHtml(t("exchangeRate", { items: itemQuantity(plan.itemCount), credits: creditQuantity(plan.creditCount) }))}</span>`;
    }

    function renderMaterialTotals(results, totals, estimate, hasInventory, creditMaterialPlans, materialInventory) {
      const planSummary = results
        .map((plan) => {
          const entry = guildBuffEntries().find((candidate) => candidate.hrid === plan.guildBuffHrid);
          const label = entry ? guildBuffLabel(entry.detail, entry.hrid) : plan.guildBuffHrid;
          return `<span>${escapeHtml(label)} ${plan.startLevel} -> ${plan.targetLevel}</span>`;
        })
        .join(`<span class="mwi-plan-separator">${ui().locale === "zh-CN" ? "，" : ", "}</span>`);
      const estimateRows = Object.fromEntries(((estimate && estimate.rows) || []).map((row) => [row.itemHrid, row]));
      const displayTotals =
        estimate && estimate.rows.length
          ? estimate.rows.map((row) => ({ itemHrid: row.itemHrid, count: row.required }))
          : totals;
      const materials = [...displayTotals]
        .sort(materialOrder)
        .map((item) => {
          const row = estimateRows[item.itemHrid];
          const inventoryText = row
            ? `${escapeHtml(t("inventory", { count: formatNumber(row.owned) }))} · ${item.itemHrid === "/items/guild_token" && row.missing > 0 ? `<span class="mwi-material-shortfall">${escapeHtml(t("missingCount", { count: formatNumber(row.missing) }))}</span>` : escapeHtml(t("missingCount", { count: formatNumber(row.missing) }))}`
            : escapeHtml(t("inventoryNotRead"));
          const credit = CREDIT_TYPES.find(([creditItemHrid]) => creditItemHrid === item.itemHrid);
          const isGuildCredit = Boolean(credit);
          const useGuildTokens = isGuildCredit && state.guildTokenCreditHrids.has(item.itemHrid);
          const plan = creditMaterialPlans && creditMaterialPlans[item.itemHrid];
          const tokenExchange = row && row.guildTokenExchange;
          const autoTokenExchange = row && row.autoGuildTokenExchange;
          const accent = credit ? credit[1] : item.itemHrid === "/items/guild_token" ? "#e65d68" : "#7778b4";
          const exchangeMode = useGuildTokens ? t("guildTokenCreditMode") : t("optimalItemCreditMode");
          const exchangeModeMarkup = isGuildCredit
            ? `<button class="mwi-material-exchange-mode" data-role="toggle-credit-token-mode" data-credit-hrid="${escapeHtml(item.itemHrid)}" data-active="${String(useGuildTokens)}" type="button" aria-pressed="${String(useGuildTokens)}">${escapeHtml(exchangeMode)}</button>`
            : "";
          const conversionPlans = [];
          if (row && row.missing > 0 && isGuildCredit) {
            if (tokenExchange) {
              conversionPlans.push(
                `<div class="mwi-material-plan">${renderGuildTokenMaterialPlan(tokenExchange, hasInventory, materialInventory, false)}</div>`
              );
            } else {
              if (autoTokenExchange)
                conversionPlans.push(
                  `<div class="mwi-material-plan mwi-material-plan-auto">${renderGuildTokenMaterialPlan(autoTokenExchange, hasInventory, materialInventory, true)}</div>`
                );
              if ((row.remainingMissing ?? row.missing) > 0)
                conversionPlans.push(
                  `<div class="mwi-material-plan">${renderOptimalMaterialPlan(plan, hasInventory, materialInventory)}</div>`
                );
            }
          }
          if (row && row.missing <= 0 && isGuildCredit)
            conversionPlans.push(
              `<div class="mwi-material-plan-covered">✓ ${escapeHtml(t("inventoryCoveredNoExchange"))}</div>`
            );
          const rowClass = item.itemHrid === "/items/guild_token" ? " mwi-material-row-token" : "";
          const materialIcon =
            isGuildCredit || item.itemHrid === "/items/guild_token" || item.itemHrid === "/items/coin"
              ? iconMarkup(item.itemHrid, itemNameForMaterial(item.itemHrid))
              : marketItemIconMarkup(item.itemHrid, itemNameForMaterial(item.itemHrid));
          const guideMissing = row ? Math.max(0, Number(row.remainingMissing ?? row.missing) || 0) : 0;
          return `<article class="mwi-material-row${rowClass}" data-item-hrid="${escapeHtml(item.itemHrid)}" data-guide-missing="${escapeHtml(guideMissing)}" style="--mwi-material-accent:${accent}"><div class="mwi-material-credit">${materialIcon}<span class="mwi-material-copy"><span class="mwi-material-name">${escapeHtml(itemNameForMaterial(item.itemHrid))}</span><small>${hasInventory ? inventoryText : escapeHtml(t("inventoryNotRead"))}</small></span></div><div class="mwi-material-required"><small>${escapeHtml(t("requiredThisTime"))}</small><strong>${formatNumber(item.count)}</strong></div>${exchangeModeMarkup || '<span class="mwi-material-exchange-mode-spacer" aria-hidden="true"></span>'}<div class="mwi-material-plans">${conversionPlans.join("")}</div></article>`;
        })
        .join("");
      return `<div class="mwi-plan-summary">${planSummary}</div>${renderUpgradeCostSummary(estimate, hasInventory)}<div class="mwi-material-list">${materials}</div>`;
    }

    function shrineGuidePlans(entries) {
      const byHrid = new Map(entries.map((entry) => [entry.hrid, entry]));
      return state.upgradePlans.flatMap((plan) => {
        const entry = byHrid.get(plan.guildBuffHrid);
        if (!entry || !entry.detail || !entry.detail.shrineHrid) return [];
        return [
          {
            guildBuffHrid: entry.hrid,
            shrineHrid: entry.detail.shrineHrid,
            domain: isCombatGuildBuff(entry) ? "combat" : "life",
            label: guildBuffLabel(entry.detail, entry.hrid),
            currentLevel: currentGuildBuffLevel(entry),
            targetLevel: plan.targetLevel
          }
        ];
      });
    }

    function setShrineGuideContext(context) {
      state.shrineGuideContext = context;
      scheduleShrineGuide();
      scheduleGuildExchangeAdvisor(true);
    }

    async function refreshGuildUpgrade(panel) {
      const refreshId = ++state.upgradeRefreshId;
      updateGuildTokenCreditPlanButton(panel);
      refreshOfficialItemNameCatalog();
      const status = panel.querySelector('[data-role="upgrade-status"]');
      const results = panel.querySelector('[data-role="upgrade-results"]');
      const entries = guildBuffEntries();
      if (!entries.length) {
        setShrineGuideContext(null);
        updateGuildTokenBudgetControl(panel, null, false);
        status.textContent = t("noGuildRules");
        updateRenderedMarkup(results, "");
        return;
      }
      ensureGuildUpgradePlans(entries);
      renderGuildUpgradePlans(panel, entries);
      if (!state.upgradePlans.length) {
        const hasAvailableUpgrade = entries.some((entry) => currentGuildBuffLevel(entry) < entry.maxLevel);
        const emptyStatus =
          state.upgradePresetNotice || (hasAvailableUpgrade ? t("noUpgradePlans") : t("allBuffsMaxed"));
        const emptyMessage = state.upgradePresetNotice || (hasAvailableUpgrade ? "" : t("noUpgradeMaterials"));
        setShrineGuideContext({ plans: [], estimate: { rows: [] }, creditMaterialPlans: {} });
        updateGuildTokenBudgetControl(panel, null, Array.isArray(state.characterItems));
        status.textContent = emptyStatus;
        updateRenderedMarkup(results, emptyMessage ? `<div class="mwi-empty">${escapeHtml(emptyMessage)}</div>` : "");
        return;
      }

      const result = core.aggregateGuildBuffPlans(
        state.upgradePlans.map((plan) => {
          const entry = entries.find((candidate) => candidate.hrid === plan.guildBuffHrid);
          return { ...plan, levelCosts: entry && entry.detail.levelCosts };
        })
      );
      if (result.status !== "ok") {
        setShrineGuideContext({ plans: shrineGuidePlans(entries), estimate: null, creditMaterialPlans: {} });
        const failed = result.result || {};
        status.textContent =
          failed.status === "missing_cost"
            ? t("missingLevelCost", { level: formatNumber(failed.missingLevel) })
            : t("invalidLevels");
        updateRenderedMarkup(results, "");
        return;
      }
      let estimate = null;
      let creditMaterialPlans = null;
      let materialInventory = inventoryItemCounts();
      const hasInventory = Array.isArray(state.characterItems);
      let snapshotFailed = false;
      const requiredCreditHrids = result.totals
        .map((item) => item.itemHrid)
        .filter((itemHrid) => CREDIT_TYPES.some(([creditItemHrid]) => creditItemHrid === itemHrid));
      const needsMarketSnapshot = requiredCreditHrids.some((itemHrid) => !state.guildTokenCreditHrids.has(itemHrid));
      let creditUnitCosts = {};
      try {
        if (needsMarketSnapshot) {
          await loadSnapshot(false);
          if (refreshId !== state.upgradeRefreshId) return;
          creditUnitCosts = bestCreditUnitCosts();
        }
      } catch (_) {
        snapshotFailed = true;
      }
      if (refreshId !== state.upgradeRefreshId) return;
      estimate = core.estimateGuildUpgradeCosts(result.totals, creditUnitCosts, materialInventory, {
        guildTokenCreditHrids: Array.from(state.guildTokenCreditHrids),
        guildTokenCreditConversions: GUILD_TOKEN_CREDIT_CONVERSIONS,
        autoAllocateSurplusGuildTokens: hasInventory,
        autoGuildTokenBudget: state.autoGuildTokenBudget
      });
      updateGuildTokenBudgetControl(panel, estimate, hasInventory);
      if (!snapshotFailed && needsMarketSnapshot) creditMaterialPlans = bestCreditMaterialPlans(estimate);
      let guideEstimate = estimate;
      let guideCreditMaterialPlans = creditMaterialPlans;
      const activeGuidePlanInputs = state.upgradePlans.flatMap((plan) => {
        const entry = entries.find((candidate) => candidate.hrid === plan.guildBuffHrid);
        if (!entry) return [];
        const currentLevel = currentGuildBuffLevel(entry);
        if (currentLevel >= plan.targetLevel) return [];
        return [{ ...plan, startLevel: Math.max(currentLevel, plan.startLevel), levelCosts: entry.detail.levelCosts }];
      });
      if (
        activeGuidePlanInputs.length !== state.upgradePlans.length ||
        activeGuidePlanInputs.some((plan) => {
          const original = state.upgradePlans.find((candidate) => candidate.id === plan.id);
          return original && original.startLevel !== plan.startLevel;
        })
      ) {
        const guideResult = core.aggregateGuildBuffPlans(activeGuidePlanInputs);
        if (guideResult.status === "ok") {
          guideEstimate = core.estimateGuildUpgradeCosts(guideResult.totals, creditUnitCosts, materialInventory, {
            guildTokenCreditHrids: Array.from(state.guildTokenCreditHrids),
            guildTokenCreditConversions: GUILD_TOKEN_CREDIT_CONVERSIONS,
            autoAllocateSurplusGuildTokens: hasInventory,
            autoGuildTokenBudget: state.autoGuildTokenBudget
          });
          guideCreditMaterialPlans =
            !snapshotFailed && needsMarketSnapshot ? bestCreditMaterialPlans(guideEstimate) : null;
        } else {
          guideEstimate = null;
          guideCreditMaterialPlans = null;
        }
      }
      setShrineGuideContext({
        plans: shrineGuidePlans(entries),
        estimate: guideEstimate,
        creditMaterialPlans: guideCreditMaterialPlans || {}
      });
      const notices = [
        state.upgradePresetNotice ||
          (state.guildBuffLevels
            ? t("mergedUpgradePlans", { count: formatNumber(result.plans.length) })
            : t("unknownCurrentLevels"))
      ];
      const tokenSelection = guildTokenCreditSelectionState();
      if (tokenSelection.allSelected) notices.push(t("guildTokenCreditPlanActive"));
      else if (tokenSelection.partiallySelected)
        notices.push(t("guildTokenCreditPlanPartialActive", { count: formatNumber(tokenSelection.selectedCount) }));
      if (snapshotFailed) notices.push(t("snapshotFailed"));
      else if (needsMarketSnapshot && state.marketSnapshotFallbackActive) notices.push(t("snapshotFallbackNotice"));
      if (!hasInventory) notices.push(t("inventoryUnavailable"));
      status.textContent = notices.join(" ");
      updateRenderedMarkup(
        results,
        renderMaterialTotals(
          result.plans,
          result.totals,
          estimate,
          hasInventory,
          creditMaterialPlans,
          materialInventory
        )
      );
    }

    return {
      guildBuffEntries,
      guildBuffLabel,
      itemNameForMaterial,
      currentGuildBuffLevel,
      shrineLevelValue,
      shrineIdentityValues,
      applyGuildShrineTargets,
      updateGuildShrineTargetActions,
      addGuildUpgradePlan,
      ensureGuildUpgradePlans,
      clearGuildUpgradePlans,
      removeGuildUpgradePlan,
      guildTokenCreditSelectionState,
      updateGuildTokenCreditPlanButton,
      renderGuildTokenCreditPlanToggle,
      renderGuildTokenBudgetControl,
      setGuildTokenBudget,
      refreshGuildUpgrade
    };
  }

  return { createUpgradeView };
});


// SOURCE: src/ui/settings-view.js
(function (root, factory) {
  const api = factory(
    typeof module !== "undefined" && module.exports ? require("./shrine-effects.js") : root.MwiGuildShrineEffects
  );
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildCreditSettingsView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (effectApi) {
  "use strict";

  const HELP_SECTIONS = [
    [
      "guildPointOverview",
      [
        ["guildPointStartingBalance", ["guildPointStartingBalanceHint"]],
        ["guildPointPlanningWeeks", ["guildPointPlanningWeeksHint"]],
        ["guildPointForecastWeeks", ["guildPointForecastWeeksHint"]],
        ["guildPointStatisticsHeading", ["guildPointTrendHint", "helpForecastEvidence", "helpForecastBacktest"]],
        ["guildPointHelpDataTitle", ["guildPointHelpData"]],
        ["guildPointHelpMethodTitle", ["guildPointHelpMethod"]],
        ["guildPointHelpResultTitle", ["guildPointHelpResult"]],
        ["recentGuildPointHistory", ["manualGuildPointHint"]]
      ]
    ],
    [
      "constructionQueue",
      [
        ["buildingCatalog", ["buildingCatalogHint", "constructionQueueEmpty"]],
        ["constructionQueue", ["constructionQueueDragHint"]],
        ["guildPointPlanningHeading", ["constructionBudgetEmptySummary"]],
        ["constructionEta", ["constructionEtaNoPlanHint", "constructionEtaCoveredHint", "helpConstructionEta"]]
      ]
    ],
    [
      "trialScreenshotGuide",
      [
        ["trialHelpScreenshotScope", ["trialHelpScreenshotPreview", "trialScreenshotHelp"]],
        ["trialHelpSharing", ["trialScreenshotReady"]],
        ["trialSimpleNames", ["trialSimpleNamesHint"]],
        ["trialScreenshotMode", ["trialScreenshotHint"]]
      ]
    ],
    [
      "trialHistory",
      [
        ["trialHelpCollection", ["trialHelpHistoryPreview", "trialHistoryHint"]],
        ["trialHelpImport", ["trialImportHint"]],
        ["trialHelpPurpose", ["trialDisplayNotice"]],
        ["trialHelpFeedback", ["trialFeedbackNotice"]]
      ]
    ],
    [
      "trialColumnsCalculations",
      [
        ["trialMemberColumns", ["trialColumnsHint"]],
        ["trialColumnsCalculations", ["trialHelpColumnsPreview"]],
        ["trialHelpShare", ["trialHelpShareBody"]],
        ["trialHelpAverage", ["trialHelpAverageBody"]],
        ["trialHelpMissing", ["trialHelpMissingBody", "helpTrialCoverage", "trialPartialShare"]]
      ]
    ],
    [
      "trialPlayerRankings",
      [
        ["trialPlayerOverview", ["trialHelpOverviewPreview", "trialOverviewHelp"]],
        ["trialRankingMethod", ["trialHelpRankingPreview"]],
        ["trialHelpCounts", ["trialRankingCountHelp"]],
        ["trialHelpRankingAverage", ["trialRankingAverageHelp"]],
        ["trialRankingJoinedAt", ["trialRankingJoinedAtHelp"]],
        ["helpRankingOrder", ["trialRankingOrderHint"]],
        ["trialProfileJoinedAt", ["trialProfileJoinedAtHelp"]],
        ["trialPlayerProfile", ["trialProfileObservation"]]
      ]
    ],
    [
      "shrineUpgrade",
      [
        ["shrineUpgrade", ["noUpgradePlansHint", "targetButtonReady"]],
        ["shrineEffectComparison", ["shrineStepsHint"]],
        ["useGuildTokensForMissingCredits", ["useGuildTokensForMissingCreditsHint", "helpCreditExchangeMode"]],
        ["autoGuildTokenBudget", ["autoGuildTokenBudgetHint"]],
        ["guideEnable", ["guideReadyHint", "guideNoPlansHint"]]
      ]
    ],
    [
      "helpSettingsAndMarket",
      [
        ["interfaceSettings", ["interfaceSettingsHint"]],
        ["shrineAutofillRange", ["shrineAutofillRangeHint"]],
        ["sidebarDisplayName", ["sidebarDisplayNameHint"]],
        ["showConstructionView", ["showConstructionViewHint"]],
        ["showTrialHistoryView", ["showTrialHistoryViewHint"]],
        ["priceReference", ["priceReferenceATitle", "priceReferenceBTitle"]],
        ["maxItemUnitPriceInput", ["maxItemUnitPriceHint"]]
      ]
    ]
  ];

  function createSettingsView(dependencies) {
    const {
      state,
      t,
      ui,
      core,
      escapeHtml,
      guildBuffEntries,
      guildBuffLabel,
      guildBuildingSpriteBaseHref,
      guildBuildingIconMarkup,
      updateRenderedMarkup
    } = dependencies;
    const effects = effectApi.createFormatter({ core, t, ui });
    function renderGuildBuffEffects(detail) {
      return effects.perLevel(detail, "\n").split("\n").map(escapeHtml).join("<br>");
    }

    function currentExcludedGuildBuffHrids() {
      const value = state.guildShrineAutofillExcludedBuffHrids;
      if (value instanceof Set) return value;
      return new Set(Array.isArray(value) ? value : []);
    }

    function guildBuffSettingsSnapshot() {
      const entries = guildBuffEntries()
        .filter((entry) => entry && entry.hrid && entry.detail)
        .sort((left, right) =>
          guildBuffLabel(left.detail, left.hrid).localeCompare(guildBuffLabel(right.detail, right.hrid), ui().locale)
        );
      return {
        entries,
        ready: entries.length > 0 || (state.guildBuffDetails !== null && state.guildBuffDetails !== undefined)
      };
    }

    function guildBuffInputId(entry) {
      return `mwi-settings-autofill-${String(entry.hrid).replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
    }

    function renderGuildBuffOption(entry, spriteBaseHref) {
      const id = guildBuffInputId(entry);
      const label = guildBuffLabel(entry.detail, entry.hrid);
      const icon = guildBuildingIconMarkup({ hrid: entry.detail.shrineHrid }, spriteBaseHref);
      return `<label class="mwi-settings-option" for="${escapeHtml(id)}"><input id="${escapeHtml(id)}" data-role="settings-shrine-autofill" data-guild-buff-hrid="${escapeHtml(entry.hrid)}" type="checkbox" aria-labelledby="${escapeHtml(id)}-name" aria-describedby="${escapeHtml(id)}-effects"><span class="mwi-settings-shrine-icon" aria-hidden="true">${icon}</span><span class="mwi-settings-shrine-copy"><span id="${escapeHtml(id)}-name" class="mwi-settings-shrine-name">${escapeHtml(label)}</span><span id="${escapeHtml(id)}-effects" class="mwi-settings-shrine-effects">${renderGuildBuffEffects(entry.detail)}</span></span></label>`;
    }

    function renderGuildBuffDomain(domain, entries, spriteBaseHref) {
      const combat = domain === "combat";
      const matching = entries.filter((entry) => (entry.detail && entry.detail.isCombat === true) === combat);
      return `<fieldset class="mwi-settings-domain" data-domain="${domain}"><legend>${escapeHtml(
        combat ? t("domainCombat") : t("domainLife")
      )}</legend><div class="mwi-settings-options">${matching.map((entry) => renderGuildBuffOption(entry, spriteBaseHref)).join("")}</div></fieldset>`;
    }

    function renderShrineAutofillSettings(snapshot) {
      if (!snapshot.ready)
        return `<p class="mwi-settings-placeholder" data-role="settings-shrines-loading" role="status">${escapeHtml(
          t("settingsShrinesLoading")
        )}</p>`;
      if (!snapshot.entries.length)
        return `<p class="mwi-settings-placeholder" data-role="settings-shrines-empty" role="status">${escapeHtml(
          t("settingsShrinesEmpty")
        )}</p>`;
      const spriteBaseHref = guildBuildingSpriteBaseHref();
      return `<div class="mwi-settings-domains">${renderGuildBuffDomain(
        "life",
        snapshot.entries,
        spriteBaseHref
      )}${renderGuildBuffDomain("combat", snapshot.entries, spriteBaseHref)}</div>`;
    }

    function renderHelp() {
      const sections = HELP_SECTIONS.map(([title, topics]) => {
        const body = topics
          .map(
            ([heading, keys]) =>
              `<div><dt>${escapeHtml(t(heading))}</dt><dd>${keys
                .flatMap((key) => t(key).split("\n"))
                .filter(Boolean)
                .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
                .join("")}</dd></div>`
          )
          .join("");
        return `<details class="mwi-context-help" data-settings-help-topic="${title}"><summary class="mwi-help-toggle" id="mwi-help-${title}">${escapeHtml(t(title))}</summary><dl class="mwi-help-sections">${body}</dl></details>`;
      }).join("");
      return `<section class="mwi-settings-block mwi-settings-help" data-role="settings-help" aria-labelledby="mwi-settings-help-heading"><div class="mwi-settings-block-heading"><h4 id="mwi-settings-help-heading">${escapeHtml(t("settingsHelp"))}</h4></div>${sections}</section>`;
    }

    function renderSettingsContent(snapshot) {
      return `<section class="mwi-settings-block" aria-labelledby="mwi-settings-autofill-heading"><div class="mwi-settings-block-heading"><h4 id="mwi-settings-autofill-heading">${escapeHtml(t("shrineAutofillRange"))}</h4></div>${renderShrineAutofillSettings(snapshot)}</section>
      <section class="mwi-settings-block" aria-labelledby="mwi-settings-interface-heading"><div class="mwi-settings-block-heading"><h4 id="mwi-settings-interface-heading">${escapeHtml(t("interfaceVisibility"))}</h4></div>
      <form class="mwi-settings-name" data-role="settings-sidebar-name-form"><label for="mwi-settings-sidebar-name">${escapeHtml(t("sidebarDisplayName"))}</label><div class="mwi-settings-name-controls"><input id="mwi-settings-sidebar-name" data-role="settings-sidebar-name" type="text" value="${escapeHtml(state.sidebarDisplayName || "")}" placeholder="${escapeHtml(t("sidebarCredit"))}" autocomplete="off"><button id="mwi-settings-sidebar-name-save" type="submit">${escapeHtml(t("sidebarNameSave"))}</button><button id="mwi-settings-sidebar-name-reset" type="button">${escapeHtml(t("sidebarNameReset"))}</button></div></form>
      <label class="mwi-settings-switch"><span class="mwi-settings-switch-copy"><strong>${escapeHtml(t("showConstructionView"))}</strong></span><input id="mwi-settings-show-construction" class="mwi-settings-switch-input" data-role="settings-show-construction" type="checkbox" role="switch"></label>
      <label class="mwi-settings-switch"><span class="mwi-settings-switch-copy"><strong>${escapeHtml(t("showTrialHistoryView"))}</strong></span><input id="mwi-settings-show-trials" class="mwi-settings-switch-input" data-role="settings-show-trials" type="checkbox" role="switch"></label></section>${renderHelp()}`;
    }

    function renderSettingsMarkup() {
      const snapshot = guildBuffSettingsSnapshot();
      const hidden = state.settingsOpen === true ? "" : " hidden";
      return `<section id="mwi-settings-panel" class="mwi-settings-panel" data-role="settings-panel" aria-labelledby="mwi-settings-title" tabindex="-1"${hidden}><header class="mwi-settings-header"><span><h3 id="mwi-settings-title">${escapeHtml(
        t("interfaceSettings")
      )}</h3></span><button class="mwi-settings-close" data-role="settings-close" type="button" title="${escapeHtml(
        t("backFromSettings")
      )}" aria-label="${escapeHtml(t("backFromSettings"))}">${escapeHtml(t("backFromSettings"))}</button></header><div class="mwi-settings-content" data-role="settings-content">${renderSettingsContent(
        snapshot
      )}</div><p class="mwi-settings-status" data-role="settings-status" role="status" aria-live="polite" aria-atomic="true"></p></section>`;
    }

    function refreshSettings(panel) {
      if (!panel || typeof panel.querySelector !== "function") return null;
      const settingsPanel =
        (typeof panel.matches === "function" && panel.matches('[data-role="settings-panel"]') && panel) ||
        panel.querySelector('[data-role="settings-panel"]');
      if (!settingsPanel) return null;
      settingsPanel.hidden = state.settingsOpen !== true;
      const content = settingsPanel.querySelector('[data-role="settings-content"]');
      const snapshot = guildBuffSettingsSnapshot();
      const nameInput = settingsPanel.querySelector('[data-role="settings-sidebar-name"]');
      const draftName = nameInput?.value;
      const focused = content?.ownerDocument?.activeElement;
      const focusedId = focused && content.contains(focused) ? focused.id : "";
      const selection = focused === nameInput ? [nameInput.selectionStart, nameInput.selectionEnd] : null;
      const openHelpTopics = new Set(
        Array.from(
          content?.querySelectorAll("[data-settings-help-topic][open]") || [],
          (node) => node.dataset.settingsHelpTopic
        )
      );
      updateRenderedMarkup(content, renderSettingsContent(snapshot));
      for (const topic of content?.querySelectorAll("[data-settings-help-topic]") || [])
        topic.open = openHelpTopics.has(topic.dataset.settingsHelpTopic);
      const updatedNameInput = settingsPanel.querySelector('[data-role="settings-sidebar-name"]');
      if (updatedNameInput && draftName !== undefined) updatedNameInput.value = draftName;
      const excludedHrids = currentExcludedGuildBuffHrids();
      for (const input of settingsPanel.querySelectorAll('[data-role="settings-shrine-autofill"]'))
        input.checked = !excludedHrids.has(input.dataset.guildBuffHrid);
      const constructionInput = settingsPanel.querySelector('[data-role="settings-show-construction"]');
      if (constructionInput) constructionInput.checked = state.showConstructionView === true;
      const trialsInput = settingsPanel.querySelector('[data-role="settings-show-trials"]');
      if (trialsInput) trialsInput.checked = state.showTrialHistoryView === true;
      if (focusedId && !focused.isConnected) {
        const replacement = content.ownerDocument.getElementById(focusedId);
        if (replacement && content.contains(replacement)) {
          replacement.focus({ preventScroll: true });
          if (selection && typeof replacement.setSelectionRange === "function")
            replacement.setSelectionRange(...selection);
        }
      }
      return settingsPanel;
    }

    return { renderSettingsMarkup, refreshSettings };
  }

  return { createSettingsView };
});


// SOURCE: src/ui/shrine-guide-ui.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildCreditShrineGuideUi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function shrineGuideAutofillQuantity(step) {
    const quantity = Number(step && step.suggestedCredits);
    return Number.isSafeInteger(quantity) && quantity >= 0 ? quantity : null;
  }

  function setNativeInputValue(input, value) {
    if (!input) return false;
    const nextValue = String(value);
    if (String(input.value) === nextValue) return false;
    const view = (input.ownerDocument && input.ownerDocument.defaultView) || globalThis;
    const prototype = view.HTMLInputElement && view.HTMLInputElement.prototype;
    const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && descriptor.set) descriptor.set.call(input, nextValue);
    else input.value = nextValue;
    const EventConstructor = view.Event || Event;
    input.dispatchEvent(new EventConstructor("input", { bubbles: true }));
    input.dispatchEvent(new EventConstructor("change", { bubbles: true }));
    return true;
  }

  function createShrineGuideUi(dependencies) {
    const {
      state,
      document,
      window,
      stylesApi,
      t,
      ui,
      formatNumber,
      itemNameForMaterial,
      CREDIT_TYPES,
      shrineGuideApi,
      refreshGuildUpgrade,
      persistPluginUiState,
      scheduleGuildExchangeAdvisor,
      guildExchangeMutationObserver,
      findGuildExchangeModal
    } = dependencies;

    const SHRINE_GUIDE_STYLE_ID = "mwi-shrine-guide-native-style";
    const SHRINE_GUIDE_QUANTITY_HINT_ID = "mwi-shrine-guide-quantity-hint";
    let autofillInput = null;
    let autofillSignature = "";

    function ensureShrineGuideStyle() {
      if (document.getElementById(SHRINE_GUIDE_STYLE_ID)) return;
      const style = document.createElement("style");
      style.id = SHRINE_GUIDE_STYLE_ID;
      style.textContent = stylesApi.shrineGuideStyles(SHRINE_GUIDE_QUANTITY_HINT_ID);
      (document.head || document.documentElement).append(style);
    }

    function clearShrineGuideHighlights() {
      for (const node of state.shrineGuideObservedNodes) {
        if (!node || !node.removeAttribute) continue;
        node.removeAttribute("data-mwi-shrine-guide");
        if (node.style) node.style.removeProperty("--mwi-guide-color");
      }
      state.shrineGuideObservedNodes.clear();
    }

    function removeShrineGuideQuantityHint() {
      const hint = document.getElementById(SHRINE_GUIDE_QUANTITY_HINT_ID);
      const input = hint && hint.__mwiGuideQuantityInput;
      if (input && input.getAttribute) {
        const ids = String(input.getAttribute("aria-describedby") || "")
          .split(/\s+/)
          .filter((id) => id && id !== SHRINE_GUIDE_QUANTITY_HINT_ID);
        if (ids.length) input.setAttribute("aria-describedby", ids.join(" "));
        else input.removeAttribute("aria-describedby");
      }
      if (hint) hint.remove();
      const visualHint = state.exchangeAdvisorUi && state.exchangeAdvisorUi.quantityHint;
      if (visualHint && !visualHint.hidden) {
        visualHint.hidden = true;
        scheduleGuildExchangeAdvisor();
      }
    }

    function resetShrineGuideAutofill() {
      autofillInput = null;
      autofillSignature = "";
    }

    function prefillShrineGuideQuantityInput(modal, step) {
      const input = modal && modal.quantityInput;
      const quantity = shrineGuideAutofillQuantity(step);
      if (!input || !input.isConnected || quantity === null) return false;
      const signature = [step.creditItemHrid, step.recommendedItemHrid, quantity].join(":");
      if (autofillInput === input && autofillSignature === signature) return false;
      autofillInput = input;
      autofillSignature = signature;
      return setNativeInputValue(input, quantity);
    }

    function shrineGuideQuantityRow(modal) {
      const input = modal && modal.quantityInput;
      const surface = modal && modal.element;
      if (!input || !surface || !surface.contains(input)) return null;
      const targetQuantityGroup = input.closest && input.closest('[class*="GuildPanel_quantityInputs"]');
      if (targetQuantityGroup && surface.contains(targetQuantityGroup)) return targetQuantityGroup;
      let fallback = input.parentElement;
      let candidate = fallback;
      for (let depth = 0; candidate && candidate !== surface && depth < 4; depth += 1) {
        if (candidate.querySelectorAll("input").length === 1 && candidate.querySelector("button")) return candidate;
        candidate = candidate.parentElement;
      }
      return fallback && fallback !== surface ? fallback : input.parentElement;
    }

    function shrineGuideQuantityInputIsTopmost(modal) {
      const input = modal && modal.quantityInput;
      if (!visibleGuideNode(input) || typeof document.elementFromPoint !== "function")
        return Boolean(input && input.isConnected);
      const rect = input.getBoundingClientRect();
      const x = Math.max(
        0,
        Math.min((document.documentElement.clientWidth || window.innerWidth) - 1, rect.left + rect.width / 2)
      );
      const y = Math.max(
        0,
        Math.min((document.documentElement.clientHeight || window.innerHeight) - 1, rect.top + rect.height / 2)
      );
      const topNode = document.elementFromPoint(x, y);
      return topNode === input || Boolean(topNode && topNode.closest && topNode.closest("input") === input);
    }

    function updateShrineGuideQuantityHint(modal, step, color) {
      const input = modal && modal.quantityInput;
      const quantityRow = shrineGuideQuantityRow(modal);
      if (
        !input ||
        !input.isConnected ||
        !quantityRow ||
        !step ||
        !Number.isSafeInteger(step.suggestedBatches) ||
        step.suggestedBatches < 0 ||
        !shrineGuideQuantityInputIsTopmost(modal)
      ) {
        removeShrineGuideQuantityHint();
        return;
      }
      ensureShrineGuideStyle();
      let hint = document.getElementById(SHRINE_GUIDE_QUANTITY_HINT_ID);
      if (!hint) {
        hint = document.createElement("aside");
        hint.id = SHRINE_GUIDE_QUANTITY_HINT_ID;
        hint.setAttribute("role", "status");
        hint.setAttribute("aria-live", "polite");
      }
      if (hint.previousElementSibling !== quantityRow || hint.parentElement !== quantityRow.parentElement)
        quantityRow.insertAdjacentElement("afterend", hint);
      if (hint.__mwiGuideQuantityInput && hint.__mwiGuideQuantityInput !== input) {
        const previous = hint.__mwiGuideQuantityInput;
        const previousIds = String(previous.getAttribute("aria-describedby") || "")
          .split(/\s+/)
          .filter((id) => id && id !== SHRINE_GUIDE_QUANTITY_HINT_ID);
        if (previousIds.length) previous.setAttribute("aria-describedby", previousIds.join(" "));
        else previous.removeAttribute("aria-describedby");
      }
      hint.__mwiGuideQuantityInput = input;
      const describedBy = new Set(
        String(input.getAttribute("aria-describedby") || "")
          .split(/\s+/)
          .filter(Boolean)
      );
      describedBy.add(SHRINE_GUIDE_QUANTITY_HINT_ID);
      input.setAttribute("aria-describedby", Array.from(describedBy).join(" "));
      const suggestedBatches = formatNumber(step.suggestedBatches);
      const limited = step.suggestedBatches < step.batches;
      const detail =
        step.method === "guild_token"
          ? t("guideTokenQuantityDetail", {
              batches: suggestedBatches,
              items: formatNumber(step.suggestedItems)
            })
          : limited
            ? t("guideQuantityCurrentExchange", { count: suggestedBatches })
            : "";
      const planSummary = t("guideQuantityPlanSummary", {
        item: itemNameForMaterial(step.recommendedItemHrid),
        items: formatNumber(step.requiredItems),
        credit: itemNameForMaterial(step.creditItemHrid),
        credits: formatNumber(step.actualCredits)
      });
      const accessibleText = detail ? `${planSummary} ${detail}` : planSummary;
      setGuideText(hint, accessibleText);
      hint.setAttribute("aria-label", accessibleText);

      const advisorUi = state.exchangeAdvisorUi;
      const visualHint = advisorUi && advisorUi.quantityHint;
      if (!visualHint) return;
      advisorUi.surface.style.setProperty("--credit", color || "#63e6c8");
      setGuideText(visualHint.querySelector('[data-role="quantity-hint-summary"]'), planSummary);
      const detailNode = visualHint.querySelector('[data-role="quantity-hint-detail"]');
      detailNode.hidden = !detail;
      setGuideText(detailNode, detail);
      visualHint.hidden = false;
      scheduleGuildExchangeAdvisor();
    }

    function markShrineGuideNode(node, role, color) {
      if (!node || !node.setAttribute) return false;
      node.setAttribute("data-mwi-shrine-guide", role);
      if (node.style) node.style.setProperty("--mwi-guide-color", color || "#63e6c8");
      state.shrineGuideObservedNodes.add(node);
      return true;
    }

    function guideCreditColor(itemHrid) {
      return CREDIT_TYPES.find(([candidate]) => candidate === itemHrid)?.[1] || "#63e6c8";
    }

    function visibleGuideNode(node) {
      if (!node || !node.isConnected || node.closest("#mwi-credit-optimizer")) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    }

    function nativeUseNodes(fragment) {
      return Array.from(document.querySelectorAll("use")).filter((use) => {
        const href = use.getAttribute("href") || use.getAttribute("xlink:href") || "";
        return href.endsWith(`#${fragment}`);
      });
    }

    function nativeCreditCards(itemHrid) {
      const fragment = String(itemHrid || "")
        .split("/")
        .pop();
      return nativeUseNodes(fragment).flatMap((use) => {
        const tile = use.closest('[class*="GuildPanel_guildTile"]');
        return tile && visibleGuideNode(tile) ? [tile] : [];
      });
    }

    function nativeRecommendedItems(itemHrid) {
      const fragment = String(itemHrid || "")
        .split("/")
        .pop();
      return nativeUseNodes(fragment).flatMap((use) => {
        const item = use.closest('[class*="Item_item"]');
        const exchangeSurface =
          item &&
          item.closest('[class*="GuildPanel_exchangeModalContent"],[class*="Modal_modal"],[class*="ItemSelector"]');
        return item && exchangeSurface && visibleGuideNode(item) ? [item] : [];
      });
    }

    function nativeShrineCards(plan) {
      const fragment = `guild_shrine_${String(plan.shrineHrid || "")
        .split("/")
        .pop()}`;
      const domainAliases =
        plan.domain === "combat" ? [t("domainCombat"), "Combat"] : [t("domainLife"), "Life", "Skilling"];
      const cards = nativeUseNodes(fragment).flatMap((use) => {
        const tile = use.closest('[class*="GuildPanel_guildTile"]');
        return tile && visibleGuideNode(tile) ? [tile] : [];
      });
      const exact = cards.filter((card) =>
        domainAliases.some((alias) => String(card.textContent || "").includes(alias))
      );
      return exact.length ? exact : cards;
    }

    function nativeGuildTab(aliases) {
      return (
        Array.from(document.querySelectorAll('[role="tab"]')).find(
          (tab) => aliases.includes(String(tab.textContent || "").trim()) && visibleGuideNode(tab)
        ) || null
      );
    }

    function guideAttributeSelectorValue(value) {
      if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(String(value || ""));
      return String(value || "")
        .replaceAll("\\", "\\\\")
        .replaceAll('"', '\\"');
    }

    function shrineGuideStatusCopy(model) {
      if (!model || model.status === "inactive") return { title: t("guideReady"), detail: "" };
      if (model.status === "no_plans") return { title: t("guideNoPlans"), detail: "" };
      if (model.status === "loading") return { title: t("guideLoading"), detail: t("guideLoadingHint") };
      if (model.status === "complete") return { title: t("guideComplete"), detail: t("guideCompleteHint") };
      if (model.status === "choose_credit") {
        const names = model.missingCredits
          .map((step) => itemNameForMaterial(step.creditItemHrid))
          .join(ui().locale === "zh-CN" ? "、" : ", ");
        return {
          title: t("guideMissingCredits", { count: formatNumber(model.missingCredits.length) }),
          detail: t("guideMissingCreditsHint", { items: names })
        };
      }
      if (model.status === "choose_item") {
        const step = model.activeCredit;
        return {
          title: t("guideChooseItem", { item: itemNameForMaterial(step.recommendedItemHrid) }),
          detail: t("guideChooseItemHint", { credit: itemNameForMaterial(step.creditItemHrid) })
        };
      }
      if (model.status === "set_quantity") {
        const step = model.activeCredit;
        const limited = step.suggestedBatches < step.batches;
        return {
          title: t("guideSetQuantity", { count: formatNumber(step.suggestedBatches) }),
          detail: limited
            ? t("guideSetQuantityLimitHint", {
                remaining: formatNumber(step.batches),
                max: formatNumber(step.maxBatches)
              })
            : t("guideSetQuantityHint", {
                items: formatNumber(step.suggestedItems),
                item: itemNameForMaterial(step.recommendedItemHrid),
                credits: formatNumber(step.suggestedCredits)
              })
        };
      }
      if (model.status === "use_guild_token") {
        const step = model.activeCredit;
        return {
          title: t("guideUseGuildTokens", { count: formatNumber(step.requiredItems) }),
          detail: t("guideUseGuildTokensHint", { credit: itemNameForMaterial(step.creditItemHrid) })
        };
      }
      if (model.status === "unavailable") return { title: t("guideUnavailable"), detail: t("guideUnavailableHint") };
      if (model.status === "blocked") {
        const items = model.blockers
          .map((item) => `${itemNameForMaterial(item.itemHrid)} × ${formatNumber(item.missing)}`)
          .join(ui().locale === "zh-CN" ? "、" : ", ");
        return { title: t("guideBlocked"), detail: t("guideBlockedHint", { items }) };
      }
      const names = model.targetPlans.map((plan) => plan.label).join(ui().locale === "zh-CN" ? "、" : ", ");
      return { title: t("guideUpgradeShrine"), detail: t("guideUpgradeShrineHint", { shrines: names }) };
    }

    function setGuideText(node, value) {
      if (node && node.textContent !== value) node.textContent = value;
    }

    function updateShrineGuideUi(model) {
      const panel = state.panel;
      if (!panel) return;
      const route = panel.querySelector('[data-role="shrine-guide-route"]');
      const button = panel.querySelector('[data-role="toggle-shrine-guide"]');
      if (!route || !button) return;
      const copy = shrineGuideStatusCopy(model);
      route.dataset.active = String(state.shrineGuideEnabled);
      route.dataset.status = (model && model.status) || "inactive";
      button.setAttribute("aria-pressed", String(state.shrineGuideEnabled));
      setGuideText(
        button.querySelector("span:last-child"),
        state.shrineGuideEnabled ? t("guideDisable") : t("guideEnable")
      );
      setGuideText(route.querySelector('[data-role="shrine-guide-title"]'), copy.title);
      setGuideText(route.querySelector('[data-role="shrine-guide-detail"]'), copy.detail);
    }

    function applyShrineGuide(model, modal) {
      clearShrineGuideHighlights();
      updateShrineGuideUi(model);
      if (!state.shrineGuideEnabled || !model || model.status !== "set_quantity") {
        resetShrineGuideAutofill();
        removeShrineGuideQuantityHint();
      }
      if (!state.shrineGuideEnabled || !model || ["inactive", "no_plans", "complete"].includes(model.status)) return;
      ensureShrineGuideStyle();

      for (const plan of model.targetPlans) {
        const selector = `.mwi-upgrade-plan[data-guild-buff-hrid="${guideAttributeSelectorValue(plan.guildBuffHrid)}"]`;
        markShrineGuideNode(
          state.panel && state.panel.querySelector(selector),
          model.status === "upgrade_shrine" ? "active" : "goal",
          "#9b8cff"
        );
        for (const card of nativeShrineCards(plan))
          markShrineGuideNode(card, model.status === "upgrade_shrine" ? "active" : "goal", "#9b8cff");
      }

      let foundNativeCredit = false;
      for (const step of model.missingCredits) {
        const active = model.activeCredit && model.activeCredit.creditItemHrid === step.creditItemHrid;
        const role = active ? "active" : "pending";
        const color = guideCreditColor(step.creditItemHrid);
        const selector = `.mwi-material-row[data-item-hrid="${guideAttributeSelectorValue(step.creditItemHrid)}"]`;
        markShrineGuideNode(state.panel && state.panel.querySelector(selector), role, color);
        for (const card of nativeCreditCards(step.creditItemHrid)) {
          foundNativeCredit = true;
          markShrineGuideNode(card, role, color);
        }
      }

      if (model.missingCredits.length && !foundNativeCredit && !modal) {
        markShrineGuideNode(nativeGuildTab([t("nativeGuildShopTab"), "Shop"]), "active", "#63e6c8");
      }
      if (model.activeCredit) {
        const step = model.activeCredit;
        const color = guideCreditColor(step.creditItemHrid);
        const pluginItem =
          state.panel &&
          state.panel.querySelector(
            `[data-guide-item-hrid="${guideAttributeSelectorValue(step.recommendedItemHrid)}"]`
          );
        markShrineGuideNode(pluginItem, "active", color);
        if (step.recommendedItemHrid) {
          for (const item of nativeRecommendedItems(step.recommendedItemHrid))
            markShrineGuideNode(item, "active", color);
        }
        if (model.status === "set_quantity" && modal && modal.quantityInput) {
          markShrineGuideNode(modal.quantityInput, "active", color);
          prefillShrineGuideQuantityInput(modal, step);
          updateShrineGuideQuantityHint(modal, step, color);
        }
      }
      if (model.status === "upgrade_shrine" && !model.targetPlans.some((plan) => nativeShrineCards(plan).length)) {
        markShrineGuideNode(nativeGuildTab([t("nativeGuildShopTab"), "Shop"]), "active", "#9b8cff");
      }
    }

    function refreshShrineGuide() {
      const modal = findGuildExchangeModal();
      const context = state.shrineGuideContext || {};
      const model = shrineGuideApi.deriveShrineGuide({
        enabled: state.shrineGuideEnabled,
        plans: context.plans || [],
        estimate: context.estimate || null,
        creditMaterialPlans: context.creditMaterialPlans || {},
        creditOrder: CREDIT_TYPES.map(([itemHrid]) => itemHrid),
        characterItems: state.characterItems,
        modal
      });
      state.shrineGuideModel = model;
      applyShrineGuide(model, modal);
    }

    function scheduleShrineGuide() {
      if (state.shrineGuideFrame !== null) return;
      const requestFrame =
        typeof window.requestAnimationFrame === "function"
          ? window.requestAnimationFrame.bind(window)
          : (handler) => window.setTimeout(handler, 0);
      state.shrineGuideFrame = requestFrame(() => {
        state.shrineGuideFrame = null;
        refreshShrineGuide();
      });
    }

    function guideMutationMayMatter(node) {
      if (!node || node.nodeType !== 1) return false;
      if (node.id === "mwi-credit-optimizer" || (node.closest && node.closest("#mwi-credit-optimizer"))) return true;
      const selector =
        '[class*="GuildPanel_guildTile"],[class*="GuildPanel_exchangeModalContent"],[class*="Modal_modal"],[class*="ItemSelector"],[class*="Item_item"],[role="tab"]';
      if (node.matches && node.matches(selector)) return true;
      return Boolean(node.querySelector && node.querySelector(selector));
    }

    function guideInteractionMayMatter(target) {
      if (!target || typeof target.closest !== "function") return false;
      return Boolean(
        target.closest(
          '#mwi-credit-optimizer,[class*="GuildPanel"],[class*="Modal_modal"],[class*="ItemSelector"],[role="tab"]'
        )
      );
    }

    function startShrineGuideObserver() {
      ensureShrineGuideStyle();
      if (document.body && !state.shrineGuideObserver) {
        const Observer = guildExchangeMutationObserver();
        if (Observer) {
          state.shrineGuideObserver = new Observer((mutations) => {
            if (
              mutations.some((mutation) =>
                [...Array.from(mutation.addedNodes || []), ...Array.from(mutation.removedNodes || [])].some(
                  guideMutationMayMatter
                )
              )
            )
              scheduleShrineGuide();
          });
          state.shrineGuideObserver.observe(document.body, { childList: true, subtree: true });
        }
      }
      if (!state.shrineGuideDocumentListenersInstalled) {
        const schedule = (event) => {
          if (state.shrineGuideEnabled && guideInteractionMayMatter(event.target)) scheduleShrineGuide();
        };
        const schedulePosition = () => {
          if (state.shrineGuideEnabled) scheduleShrineGuide();
        };
        document.addEventListener("click", schedule, true);
        document.addEventListener("input", schedule, true);
        document.addEventListener("change", schedule, true);
        document.addEventListener("scroll", schedulePosition, true);
        window.addEventListener("resize", schedulePosition, true);
        state.shrineGuideDocumentHandlers = { schedule, schedulePosition };
        state.shrineGuideDocumentListenersInstalled = true;
      }
    }

    function stopShrineGuideObserver() {
      if (state.shrineGuideObserver) state.shrineGuideObserver.disconnect();
      state.shrineGuideObserver = null;
      if (state.shrineGuideDocumentHandlers) {
        const { schedule, schedulePosition } = state.shrineGuideDocumentHandlers;
        document.removeEventListener("click", schedule, true);
        document.removeEventListener("input", schedule, true);
        document.removeEventListener("change", schedule, true);
        document.removeEventListener("scroll", schedulePosition, true);
        window.removeEventListener("resize", schedulePosition, true);
      }
      state.shrineGuideDocumentHandlers = null;
      state.shrineGuideDocumentListenersInstalled = false;
      clearShrineGuideHighlights();
      removeShrineGuideQuantityHint();
    }

    function setShrineGuideEnabled(panel, enabled) {
      state.shrineGuideEnabled = enabled === true;
      persistPluginUiState();
      if (state.shrineGuideEnabled) {
        startShrineGuideObserver();
        scheduleShrineGuide();
        refreshGuildUpgrade(panel);
      } else {
        stopShrineGuideObserver();
        scheduleShrineGuide();
      }
      scheduleGuildExchangeAdvisor(true);
    }

    return {
      scheduleShrineGuide,
      startShrineGuideObserver,
      stopShrineGuideObserver,
      setShrineGuideEnabled
    };
  }

  return { createShrineGuideUi, shrineGuideAutofillQuantity, setNativeInputValue };
});


// SOURCE: src/ui/exchange-advisor.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildCreditExchangeAdvisor = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function guildExchangeQuantityInputs(element) {
    if (!element || typeof element.querySelectorAll !== "function") return { paymentInput: null, quantityInput: null };
    const containers = Array.from(element.querySelectorAll('[class*="GuildPanel_inputContainer"]'));
    const fields = containers
      .map((container) => {
        const input = container.querySelector("input");
        const label = container.querySelector('[class*="GuildPanel_label"]');
        return {
          input,
          label: String((label && label.textContent) || "")
            .replaceAll("\n", " ")
            .trim()
        };
      })
      .filter((field) => field.input);
    if (fields.length) {
      const targetField = fields.find((field) => /你獲得|\byou\s+(?:receive|get)\b/i.test(field.label));
      const paymentField = fields.find((field) => /你支付|\byou\s+pay\b/i.test(field.label));
      return {
        paymentInput: (paymentField && paymentField.input) || (fields.length > 1 ? fields[0].input : null),
        quantityInput: (targetField && targetField.input) || fields[fields.length - 1].input
      };
    }
    const legacyInput =
      element.querySelector('input[type="number"]') ||
      element.querySelector('input[inputmode="numeric"]') ||
      element.querySelector('input[type="text"]');
    return { paymentInput: null, quantityInput: legacyInput || null };
  }

  function guildExchangeBatches(modalData, conversion) {
    const itemCount = Number(conversion && conversion.itemCount);
    const creditCount = Number(conversion && conversion.creditCount);
    const paymentQuantity = Number(modalData && modalData.paymentQuantity);
    const targetQuantity = Number(modalData && modalData.targetQuantity);
    if (
      Number.isSafeInteger(paymentQuantity) &&
      paymentQuantity > 0 &&
      Number.isSafeInteger(itemCount) &&
      itemCount > 0 &&
      paymentQuantity % itemCount === 0
    )
      return paymentQuantity / itemCount;
    if (
      Number.isSafeInteger(targetQuantity) &&
      targetQuantity > 0 &&
      Number.isSafeInteger(creditCount) &&
      creditCount > 0 &&
      targetQuantity % creditCount === 0
    )
      return targetQuantity / creditCount;
    const fallback = Number(modalData && modalData.batches);
    return Number.isSafeInteger(fallback) && fallback > 0 ? fallback : 1;
  }

  function inputMaximum(input) {
    if (!input) return null;
    const attributeValue = input.getAttribute && input.getAttribute("max");
    const raw = String(
      attributeValue === null || attributeValue === undefined ? input.max || "" : attributeValue
    ).trim();
    if (!raw) return null;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  function calculateGuildExchangeAdvisorPosition(modalRect, cardRect, viewportWidth, viewportHeight) {
    const margin = 12;
    const gap = 12;
    const width = Math.max(1, cardRect.width);
    const height = Math.max(1, cardRect.height);
    const clampLeft = (value) => Math.max(margin, Math.min(value, viewportWidth - width - margin));
    const clampTop = (value) => Math.max(margin, Math.min(value, viewportHeight - height - margin));
    const alignedTop = Math.max(margin, modalRect.top);
    if (modalRect.right + gap + width <= viewportWidth - margin)
      return { placement: "right", left: modalRect.right + gap, top: alignedTop };
    if (modalRect.left - gap - width >= margin)
      return { placement: "left", left: modalRect.left - gap - width, top: alignedTop };
    if (modalRect.bottom + gap + height <= viewportHeight - margin)
      return {
        placement: "bottom",
        left: clampLeft(modalRect.left + (modalRect.width - width) / 2),
        top: modalRect.bottom + gap
      };
    if (modalRect.top - gap - height >= margin)
      return {
        placement: "top",
        left: clampLeft(modalRect.left + (modalRect.width - width) / 2),
        top: modalRect.top - gap - height
      };
    return {
      placement: "overlay",
      left: clampLeft(modalRect.left + (modalRect.width - width) / 2),
      top: clampTop(viewportHeight - height - margin)
    };
  }

  function setGuildExchangeAdvisorCollapsed(ui, collapsed, labels) {
    if (!ui || !ui.card || typeof ui.card.querySelector !== "function") return false;
    const isCollapsed = Boolean(collapsed);
    const content = ui.card.querySelector('[data-role="advisor-content"]');
    const toggle = ui.card.querySelector('[data-role="toggle-advisor"]');
    ui.collapsed = isCollapsed;
    ui.card.dataset.collapsed = String(isCollapsed);
    if (content) content.hidden = isCollapsed;
    if (toggle) {
      const label = isCollapsed ? labels.expand : labels.collapse;
      toggle.setAttribute("aria-expanded", String(!isCollapsed));
      toggle.setAttribute("aria-label", label);
      toggle.title = label;
    }
    return true;
  }

  function createExchangeAdvisor(dependencies) {
    const {
      state,
      document,
      window,
      pageWindow,
      stylesApi,
      CREDIT_TYPES,
      SELLER_TAX_RATE,
      t,
      escapeHtml,
      formatNumber,
      itemNameForMaterial,
      itemHridFromIcon,
      enhancementLevelFromIcon,
      itemQuantity,
      creditQuantity,
      iconMarkup,
      priceReference,
      core,
      loadSnapshot,
      snapshotOrderBook,
      snapshotImmediateSellPrice,
      snapshotPrice,
      allConversions,
      exchangeAdvisorFrameTask
    } = dependencies;

    function isVisible(node) {
      const modal = (node && node.closest && node.closest('[class*="Modal_modal"]')) || node;
      if (!modal || !modal.isConnected || modal.hidden || modal.getAttribute("aria-hidden") === "true") return false;
      const rect = modal.getBoundingClientRect();
      const style = getComputedStyle(modal);
      const opacity = Number(style.opacity);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.pointerEvents !== "none" &&
        (!Number.isFinite(opacity) || opacity > 0.01)
      );
    }

    function findGuildExchangeModal() {
      const candidates = Array.from(document.querySelectorAll('[class*="GuildPanel_exchangeModalContent"]')).filter(
        isVisible
      );
      for (const element of candidates) {
        const modal = element.closest('[class*="Modal_modal"]') || element;
        const icons = Array.from(element.querySelectorAll('svg[role="img"][aria-label]'))
          .map((icon) => ({
            itemHrid: itemHridFromIcon(icon),
            itemName: icon.getAttribute("aria-label") || "",
            enhancementLevel: enhancementLevelFromIcon(icon)
          }))
          .filter((item) => item.itemHrid);
        const credit = icons.find((item) => CREDIT_TYPES.some(([hrid]) => hrid === item.itemHrid));
        const selected = icons.find((item) => !CREDIT_TYPES.some(([hrid]) => hrid === item.itemHrid));
        const { paymentInput, quantityInput } = guildExchangeQuantityInputs(element);
        const paymentQuantity = Number(paymentInput && paymentInput.value);
        const targetQuantity = Number(quantityInput && quantityInput.value);
        const maxTargetQuantity = inputMaximum(quantityInput);
        if (!credit) continue;
        return {
          element,
          modal,
          creditItemHrid: credit.itemHrid,
          selectedItemHrid: (selected && selected.itemHrid) || null,
          selectedEnhancementLevel: (selected && selected.enhancementLevel) || 0,
          paymentInput,
          paymentQuantity: Number.isSafeInteger(paymentQuantity) && paymentQuantity > 0 ? paymentQuantity : null,
          quantityInput,
          targetQuantity: Number.isSafeInteger(targetQuantity) && targetQuantity > 0 ? targetQuantity : null,
          maxTargetQuantity,
          batches: Number.isSafeInteger(targetQuantity) && targetQuantity > 0 ? targetQuantity : 1
        };
      }
      return null;
    }

    const GUILD_EXCHANGE_ADVISOR_HOST_ID = "mwi-guild-exchange-advisor-host";

    function createGuildExchangeAdvisorUi() {
      if (!document.body || state.exchangeAdvisorUi) return state.exchangeAdvisorUi;
      if (document.getElementById(GUILD_EXCHANGE_ADVISOR_HOST_ID)) return null;
      const host = document.createElement("div");
      host.id = GUILD_EXCHANGE_ADVISOR_HOST_ID;
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = `<style>${stylesApi.GUILD_EXCHANGE_ADVISOR_STYLES}</style><div class="advisor-stack" data-role="advisor-stack" hidden><aside class="advisor" data-role="advisor" aria-live="polite" hidden></aside><aside class="guide-quantity" data-role="quantity-guide" aria-hidden="true" hidden><span class="guide-quantity-summary" data-role="quantity-hint-summary"></span><small class="guide-quantity-detail" data-role="quantity-hint-detail" hidden></small></aside></div>`;
      document.body.append(host);
      state.exchangeAdvisorUi = {
        host,
        shadow,
        surface: shadow.querySelector('[data-role="advisor-stack"]'),
        card: shadow.querySelector('[data-role="advisor"]'),
        quantityHint: shadow.querySelector('[data-role="quantity-guide"]'),
        signature: "",
        modal: null,
        collapsed: false
      };
      shadow.addEventListener("click", (event) => {
        const target = event.target && (event.target.nodeType === 1 ? event.target : event.target.parentElement);
        const toggle = target && target.closest && target.closest('[data-role="toggle-advisor"]');
        if (!toggle) return;
        const ui = state.exchangeAdvisorUi;
        setGuildExchangeAdvisorCollapsed(ui, !ui.collapsed, {
          collapse: t("collapseExchangeAdvisor"),
          expand: t("expandExchangeAdvisor")
        });
        if (ui.modal) positionGuildExchangeAdvisor(ui, ui.modal);
      });
      return state.exchangeAdvisorUi;
    }

    function hideGuildExchangeAdvisor(modalData) {
      const ui = state.exchangeAdvisorUi;
      if (!ui) return;
      ui.card.hidden = true;
      ui.signature = "";
      const modal = (modalData && modalData.modal) || null;
      if (modal && ui.quantityHint && !ui.quantityHint.hidden) {
        ui.modal = modal;
        observeActiveGuildExchangeModal(modal);
        positionGuildExchangeAdvisor(ui, modal);
        return;
      }
      ui.surface.hidden = true;
      ui.modal = null;
      observeActiveGuildExchangeModal(null);
    }

    function positionGuildExchangeAdvisor(ui, modal) {
      const surface = ui && ui.surface;
      if (!surface) return false;
      if (!modal || !modal.isConnected || !isVisible(modal)) {
        surface.hidden = true;
        return false;
      }
      if (ui.card.hidden && ui.quantityHint.hidden) {
        surface.hidden = true;
        return false;
      }
      const wasHidden = surface.hidden;
      if (wasHidden) {
        surface.style.visibility = "hidden";
        surface.hidden = false;
      }
      const modalRect = modal.getBoundingClientRect();
      const surfaceRect = surface.getBoundingClientRect();
      if (modalRect.width <= 0 || modalRect.height <= 0 || surfaceRect.width <= 0 || surfaceRect.height <= 0) {
        surface.hidden = true;
        surface.style.removeProperty("visibility");
        return false;
      }
      const position = calculateGuildExchangeAdvisorPosition(
        modalRect,
        surfaceRect,
        window.innerWidth,
        window.innerHeight
      );
      surface.dataset.placement = position.placement;
      ui.card.dataset.placement = position.placement;
      surface.style.left = `${Math.round(position.left)}px`;
      surface.style.top = `${Math.round(position.top)}px`;
      surface.style.setProperty(
        "--advisor-available-height",
        `${Math.max(1, Math.floor(window.innerHeight - position.top - 12))}px`
      );
      surface.hidden = false;
      surface.style.removeProperty("visibility");
      return true;
    }

    function advisorOptionMarkup(label, option, details, best) {
      const primary = details
        ? `${formatNumber(details.credits)}<small>${escapeHtml(t("credits"))}</small>`
        : `${core.formatCompactCost(option.costPerCredit)}<small>${escapeHtml(t("goldPerCredit"))}</small>`;
      const first = details
        ? [details.firstLabel, details.firstValue]
        : [
            t("singleExchange"),
            t("exchangeRate", { items: itemQuantity(option.itemCount), credits: creditQuantity(option.creditCount) })
          ];
      const second = details
        ? [details.secondLabel, details.secondValue]
        : [t("marketCost"), `${core.formatCompactCost(option.cost)} ${t("gold")}`];
      return `<section class="option${best ? " best" : ""}"><span class="label">${escapeHtml(label)}</span><div class="item">${iconMarkup(option.itemHrid, option.itemName)}<span class="name">${escapeHtml(option.itemName)}</span></div><div class="cost">${primary}</div><div class="detail"><span>${escapeHtml(first[0])}</span><b>${escapeHtml(first[1])}</b></div><div class="detail"><span>${escapeHtml(second[0])}</span><b>${escapeHtml(second[1])}</b></div></section>`;
    }

    function guildExchangeAdvisorMarkup(data) {
      const comparison = Boolean(data.selected && data.replacement);
      const reference = priceReference(state.priceReference).label;
      const referenceLabel = data.selected
        ? t("advisorReferenceSelected", { reference, tax: formatNumber(SELLER_TAX_RATE * 100) })
        : t("advisorReference", { reference });
      const collapseLabel = t("collapseExchangeAdvisor");
      const header = `<header class="head"><div class="title"><span>${escapeHtml(t("exchangeRecommendation"))}</span><span class="credit">${escapeHtml(data.creditName)}</span></div><div class="head-actions"><span class="reference">${escapeHtml(referenceLabel)}</span><button class="advisor-toggle" data-role="toggle-advisor" type="button" aria-controls="mwi-exchange-advisor-content" aria-expanded="true" aria-label="${escapeHtml(collapseLabel)}" title="${escapeHtml(collapseLabel)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></button></div></header>`;
      let summary = t("chooseItem");
      if (data.selectedOptimal) summary = t("alreadyOptimal");
      else if (!data.selected && data.unavailableReason) summary = data.unavailableReason;
      else if (comparison && data.replacement.creditDifference > 0)
        summary = t("sellAndBuyMore", {
          count: formatNumber(data.replacement.creditDifference),
          credit: escapeHtml(data.creditName)
        });
      else if (comparison && data.replacement.creditDifference < 0)
        summary = t("directMore", {
          count: formatNumber(-data.replacement.creditDifference),
          credit: escapeHtml(data.creditName)
        });
      else if (comparison) summary = t("sameCredits");
      const selected = comparison
        ? advisorOptionMarkup(t("selected"), data.selected, {
            credits: data.replacement.directCredits,
            firstLabel: t("directExchange"),
            firstValue: t("exchangeRate", {
              items: itemQuantity(data.replacement.sale.quantity),
              credits: creditQuantity(data.replacement.directCredits)
            }),
            secondLabel: t("afterTax"),
            secondValue: `${core.formatCompactCost(data.replacement.sale.net)} ${t("gold")}`
          })
        : "";
      const best = advisorOptionMarkup(
        data.selectedOptimal ? t("selectedOptimal") : t("bestItem"),
        data.best,
        comparison
          ? {
              credits: data.replacement.best.actualCredits,
              firstLabel: t("buybackExchange"),
              firstValue: t("exchangeRate", {
                items: itemQuantity(data.replacement.best.requiredItems),
                credits: creditQuantity(data.replacement.best.actualCredits)
              }),
              secondLabel: t("purchaseCost"),
              secondValue: `${core.formatCompactCost(data.replacement.best.cost)} ${t("gold")}`
            }
          : null,
        true
      );
      return `${header}<div class="body" id="mwi-exchange-advisor-content" data-role="advisor-content"><div class="options${comparison ? "" : " single"}">${selected}${comparison ? '<div class="versus"><span>VS</span></div>' : ""}${best}</div><div class="summary">${summary}</div></div>`;
    }

    function renderGuildExchangeAdvisor(modalData, data, forceRender) {
      const ui = state.exchangeAdvisorUi;
      if (!ui) return false;
      const markup = guildExchangeAdvisorMarkup(data);
      if (forceRender || ui.signature !== markup) {
        ui.card.innerHTML = markup;
        ui.signature = markup;
      }
      setGuildExchangeAdvisorCollapsed(ui, ui.collapsed, {
        collapse: t("collapseExchangeAdvisor"),
        expand: t("expandExchangeAdvisor")
      });
      ui.card.hidden = false;
      ui.modal = modalData.modal;
      observeActiveGuildExchangeModal(modalData.modal);
      ui.card.setAttribute("aria-label", t("exchangeRecommendation"));
      ui.surface.style.setProperty("--credit", data.color);
      return positionGuildExchangeAdvisor(ui, modalData.modal);
    }

    function refreshGuildExchangeAdvisor(forceRender) {
      const ui = state.exchangeAdvisorUi;
      if (!ui) return false;
      const modalData = findGuildExchangeModal();
      if (!modalData) {
        hideGuildExchangeAdvisor();
        return false;
      }

      const conversions = allConversions(modalData.creditItemHrid);
      if (!conversions.length) {
        hideGuildExchangeAdvisor(modalData);
        return false;
      }

      if (!state.snapshot) {
        hideGuildExchangeAdvisor(modalData);
        if (state.exchangeAdvisorSnapshotFailed) return;
        if (!state.exchangeAdvisorLoadInFlight) {
          state.exchangeAdvisorLoadInFlight = true;
          loadSnapshot(false)
            .catch(() => {
              state.exchangeAdvisorSnapshotFailed = true;
              return null;
            })
            .finally(() => {
              state.exchangeAdvisorLoadInFlight = false;
              scheduleGuildExchangeAdvisor(true);
            });
        }
        return false;
      }

      const books = Object.fromEntries(
        conversions.map((conversion) => [conversion.itemHrid, snapshotOrderBook(conversion.itemHrid)])
      );
      let best = core.rankConversions(conversions, books, 1).find((result) => result.status === "ok");
      if (!best) {
        hideGuildExchangeAdvisor(modalData);
        return false;
      }

      const selectedConversion = conversions.find((conversion) => conversion.itemHrid === modalData.selectedItemHrid);
      let selected = null;
      let replacement = null;
      let selectedOptimal = false;
      let unavailableReason = "";
      if (selectedConversion) {
        if (selectedConversion.itemHrid === best.itemHrid) {
          selectedOptimal = true;
        } else {
          const sellPrice = snapshotImmediateSellPrice(selectedConversion.itemHrid, modalData.selectedEnhancementLevel);
          const buyPrices = Object.fromEntries(
            conversions.map((conversion) => [
              conversion.itemHrid,
              snapshotPrice(conversion.itemHrid, state.priceReference)
            ])
          );
          replacement = core.estimateSaleReplacement({
            selectedConversion,
            batches: guildExchangeBatches(modalData, selectedConversion),
            sellPrice,
            sellerTaxRate: SELLER_TAX_RATE,
            conversions,
            buyPrices
          });
          if (replacement.status === "already_optimal") {
            best = replacement.best;
            selectedOptimal = true;
            replacement = null;
          } else if (replacement.status !== "ok") {
            unavailableReason =
              replacement.status === "no_affordable_conversion"
                ? t("noAffordableReplacement", { gold: `${core.formatCompactCost(replacement.sale.net)} ${t("gold")}` })
                : t("noSellPrice");
            replacement = null;
          } else {
            selected = selectedConversion;
          }
        }
      }
      const creditName = itemNameForMaterial(modalData.creditItemHrid);
      return renderGuildExchangeAdvisor(
        modalData,
        {
          creditName,
          color: CREDIT_TYPES.find(([hrid]) => hrid === modalData.creditItemHrid)?.[1] || "#4fcdb5",
          best: replacement ? replacement.best : best,
          selected,
          selectedOptimal,
          replacement,
          unavailableReason
        },
        forceRender
      );
    }

    function scheduleGuildExchangeAdvisor(forceRender) {
      if (!state.exchangeAdvisorUi) return;
      exchangeAdvisorFrameTask.schedule(Boolean(forceRender));
    }

    function guildExchangeMutationObserver() {
      return pageWindow.MutationObserver || (typeof MutationObserver === "function" ? MutationObserver : null);
    }

    function nodeMayContainGuildExchangeModal(node) {
      if (!node || node.nodeType !== 1) return false;
      const selector = '[class*="GuildPanel_exchangeModalContent"]';
      if (node.matches(selector)) return true;
      // Only child-list changes reach this observer. Inspecting each newly added
      // subtree keeps portal mounting reliable without restoring the old, costly
      // whole-page attributes/text observer.
      return Boolean(node.querySelector(selector));
    }

    function observeActiveGuildExchangeModal(modal) {
      if (state.exchangeAdvisorObservedModal === modal) return;
      if (state.exchangeAdvisorModalObserver) state.exchangeAdvisorModalObserver.disconnect();
      state.exchangeAdvisorObservedModal = modal || null;
      state.exchangeAdvisorModalObserver = null;
      if (!modal || !modal.isConnected) return;
      const Observer = guildExchangeMutationObserver();
      if (!Observer) return;
      state.exchangeAdvisorModalObserver = new Observer(() => scheduleGuildExchangeAdvisor());
      state.exchangeAdvisorModalObserver.observe(modal, {
        attributes: true,
        attributeFilter: ["aria-hidden", "class", "hidden", "style"],
        childList: true,
        subtree: true
      });
    }

    function watchGuildExchangeModals() {
      if (!document.body || state.exchangeAdvisorRootObserver) return;
      const Observer = guildExchangeMutationObserver();
      if (!Observer) return;
      state.exchangeAdvisorRootObserver = new Observer((mutations) => {
        const activeModal = state.exchangeAdvisorUi && state.exchangeAdvisorUi.modal;
        if (activeModal && !activeModal.isConnected) {
          scheduleGuildExchangeAdvisor();
          return;
        }
        if (
          Array.from(mutations || []).some((mutation) =>
            Array.from(mutation.addedNodes || []).some(nodeMayContainGuildExchangeModal)
          )
        ) {
          scheduleGuildExchangeAdvisor();
        }
      });
      state.exchangeAdvisorRootObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
      if (!state.exchangeAdvisorListenersInstalled) {
        const reposition = () => {
          if (state.exchangeAdvisorUi && state.exchangeAdvisorUi.modal) scheduleGuildExchangeAdvisor();
        };
        window.addEventListener("resize", reposition, { passive: true });
        window.addEventListener("orientationchange", reposition, { passive: true });
        window.addEventListener("scroll", reposition, { capture: true, passive: true });
        state.exchangeAdvisorRepositionHandler = reposition;
        state.exchangeAdvisorListenersInstalled = true;
      }
      scheduleGuildExchangeAdvisor(true);
    }

    function startGuildExchangeAdvisor() {
      if (!createGuildExchangeAdvisorUi()) return;
      watchGuildExchangeModals();
      scheduleGuildExchangeAdvisor(true);
    }

    return {
      findGuildExchangeModal,
      refreshGuildExchangeAdvisor,
      scheduleGuildExchangeAdvisor,
      guildExchangeMutationObserver,
      startGuildExchangeAdvisor
    };
  }

  return {
    createExchangeAdvisor,
    guildExchangeQuantityInputs,
    guildExchangeBatches,
    inputMaximum,
    calculateGuildExchangeAdvisorPosition,
    setGuildExchangeAdvisorCollapsed
  };
});


// SOURCE: src/ui/panel-shell.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildCreditPanelShell = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const NUMBER_STEP_REPEAT_DELAY_MS = 450;
  const NUMBER_STEP_REPEAT_INTERVAL_MS = 90;

  function createPanelShell(dependencies) {
    const {
      state,
      document,
      stylesApi,
      sortableApi,
      t,
      escapeHtml,
      PANEL_VIEWS,
      DEFAULT_PANEL_ORDER,
      CREDIT_TYPES,
      FALLBACK_INSTALL_URL,
      priceReference,
      normalizePanelView,
      persistPluginUiState,
      normalizeSidebarDisplayName,
      checkPluginUpdate,
      refreshPanel,
      refreshGuildUpgrade,
      refreshGuildConstruction,
      refreshTrialHistory,
      bindTrialHistory,
      refreshGuildExchangeAdvisor,
      renderSettingsMarkup,
      refreshSettings,
      renderGuildTokenCreditPlanToggle,
      renderGuildTokenBudgetControl,
      updateGuildTokenCreditPlanButton,
      setGuildTokenBudget,
      setShrineGuideEnabled,
      guildBuffEntries,
      currentGuildBuffLevel,
      applyGuildShrineTargets,
      addGuildUpgradePlan,
      clearGuildUpgradePlans,
      removeGuildUpgradePlan,
      guildTokenCreditSelectionState,
      guildBuildingDefinitions,
      addGuildBuildingPlan,
      setGuildBuildingTarget,
      removeGuildBuildingPlan,
      moveGuildBuildingPlan,
      reorderGuildBuildingPlan,
      setGuildBuildingPickerOpen,
      toggleGuildBuildingSteps,
      clearGuildBuildingPlans,
      undoClearGuildBuildingPlans,
      hasGuildBuildingClearUndo,
      applyGuildBuildingFilters,
      refreshGuildConstructionBudgetPreview,
      copyGuildConstructionPlan,
      exportGuildConstructionCsv,
      exportGuildPointHistoryCsv,
      constructionView,
      resetGuildPointHistory,
      persistGuildBuildingPlannerState,
      setPriceReference,
      openMarketplaceForItem
    } = dependencies;
    const sortableControllers = [];
    const numberStepperCleanups = [];

    const panelViewLabels = {
      upgrade: "shrineUpgrade",
      credit: "creditValue",
      construction: "guildConstruction",
      trials: "trialHistory"
    };

    function panelViewEnabled(view) {
      if (view === "construction") return state.showConstructionView === true;
      if (view === "trials") return state.showTrialHistoryView === true;
      return true;
    }

    function normalizedPanelOrder() {
      state.panelOrder = sortableApi.normalizeOrder(state.panelOrder, PANEL_VIEWS, DEFAULT_PANEL_ORDER);
      return state.panelOrder;
    }

    function visiblePanelOrder() {
      return normalizedPanelOrder().filter(panelViewEnabled);
    }

    function nearestVisiblePanelView(view) {
      const order = normalizedPanelOrder();
      const index = order.indexOf(view);
      for (let distance = 1; distance < order.length; distance += 1) {
        const after = order[index + distance];
        if (after && panelViewEnabled(after)) return after;
        const before = order[index - distance];
        if (before && panelViewEnabled(before)) return before;
      }
      return visiblePanelOrder()[0] || "credit";
    }

    function renderPanelTabs() {
      return normalizedPanelOrder()
        .map(
          (view) =>
            `<span class="mwi-view-tab-item" data-sort-key="${view}"${panelViewEnabled(view) ? "" : " hidden"}><button id="mwi-view-tab-${view}" class="mwi-view-tab${state.activeView === view ? " mwi-view-tab-active" : ""}" data-role="view-${view}" role="tab" aria-controls="mwi-view-panel-${view}" aria-selected="${String(state.activeView === view)}" tabindex="${state.activeView === view ? "0" : "-1"}" type="button">${escapeHtml(t(panelViewLabels[view]))}</button></span>`
        )
        .join("");
    }

    function reorderPanelView(panel, view, targetIndex) {
      const visibleOrder = visiblePanelOrder();
      const nextOrder = sortableApi.reorderVisibleByIndex(state.panelOrder, visibleOrder, view, targetIndex);
      if (nextOrder.every((candidate, index) => candidate === state.panelOrder[index])) return false;
      state.panelOrder = nextOrder;
      const tabList = panel.querySelector(".mwi-view-tabs");
      for (const candidate of state.panelOrder) {
        const item = tabList.querySelector(`[data-sort-key="${candidate}"]`);
        if (item) tabList.append(item);
      }
      persistPluginUiState();
      return true;
    }

    function syncPanelViewVisibility(panel) {
      for (const candidate of PANEL_VIEWS) {
        const enabled = panelViewEnabled(candidate);
        const item = panel.querySelector(`.mwi-view-tab-item[data-sort-key="${candidate}"]`);
        const tab = panel.querySelector(`[data-role="view-${candidate}"]`);
        const content = panel.querySelector(`[data-role="${candidate}-view"]`);
        if (item) item.hidden = !enabled;
        if (!enabled && tab) {
          tab.setAttribute("aria-selected", "false");
          tab.setAttribute("tabindex", "-1");
          tab.classList.remove("mwi-view-tab-active");
        }
        if (!enabled && content) content.hidden = true;
      }
    }

    function findConstructionControl(panel, target) {
      if (!target || !target.role) return null;
      return Array.from(panel.querySelectorAll(`[data-role="${target.role}"]`)).find((element) => {
        if (target.buildingHrid && element.dataset.buildingHrid !== target.buildingHrid) return false;
        if (target.direction !== undefined && element.dataset.direction !== String(target.direction)) return false;
        if (target.delta !== undefined && element.dataset.delta !== String(target.delta)) return false;
        if (target.weekStartAt !== undefined && element.dataset.weekStartAt !== String(target.weekStartAt))
          return false;
        return !element.disabled && !element.hidden && !element.closest("[hidden]");
      });
    }

    function focusConstructionControl(panel, target, reveal = true) {
      const control = findConstructionControl(panel, target);
      if (!control) return false;
      try {
        control.focus({ preventScroll: true });
      } catch (_) {
        control.focus();
      }
      if (reveal && typeof control.scrollIntoView === "function") {
        control.scrollIntoView({ block: "nearest", inline: "nearest" });
        const controlRect = control.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        const viewportHeight = document.defaultView ? document.defaultView.innerHeight : panelRect.bottom;
        const visibleTop = Math.max(0, panelRect.top);
        const visibleBottom = Math.min(viewportHeight, panelRect.bottom);
        if (controlRect.top < visibleTop) panel.scrollTop += controlRect.top - visibleTop;
        else if (controlRect.bottom > visibleBottom) panel.scrollTop += controlRect.bottom - visibleBottom;
      }
      return true;
    }

    function refreshConstructionAndFocus(panel, target, fallbackTarget = null) {
      refreshGuildConstruction(panel);
      return focusConstructionControl(panel, target) || focusConstructionControl(panel, fallbackTarget);
    }

    function setGuildPointBudgetValidity(panel, input, valid) {
      const error = panel.querySelector("#mwi-guild-point-budget-error");
      if (valid) input.removeAttribute("aria-invalid");
      else input.setAttribute("aria-invalid", "true");
      if (error) error.hidden = valid;
    }

    function guildPointBudgetInputValue(input) {
      const raw = input.value.trim();
      if (raw === "") return { valid: true, value: null };
      const value = Number(raw);
      return Number.isSafeInteger(value) && value >= 0
        ? { valid: true, value }
        : { valid: false, value: state.manualGuildPoints };
    }

    function clearConstructionNotice(panel) {
      state.buildingPlanNotice = "";
      const status = panel.querySelector('[data-role="construction-status"]');
      const statusText = status && status.querySelector('[data-role="construction-status-text"]');
      if (statusText) statusText.textContent = "";
      if (status) status.hidden = !hasGuildBuildingClearUndo();
    }

    function setPanelView(panel, view, { preserveSettings = false } = {}) {
      const selectedView = normalizePanelView(view);
      if (!panelViewEnabled(selectedView)) return false;
      if (!preserveSettings) state.settingsOpen = false;
      panel.dataset.activeView = selectedView;
      state.activeView = selectedView;
      const persisted = persistPluginUiState();
      syncSettingsPage(panel);
      if (selectedView === "upgrade") refreshGuildUpgrade(panel);
      else if (selectedView === "construction") refreshGuildConstruction(panel);
      else if (selectedView === "trials") refreshTrialHistory(panel);
      else refreshPanel(panel);
      const selectedTab = panel.querySelector(`[data-role="view-${selectedView}"]`);
      const tabList = panel.querySelector(".mwi-view-tabs");
      if (selectedTab && tabList) {
        const tabRect = selectedTab.getBoundingClientRect();
        const listRect = tabList.getBoundingClientRect();
        if (tabRect.left < listRect.left) tabList.scrollLeft += tabRect.left - listRect.left;
        else if (tabRect.right > listRect.right) tabList.scrollLeft += tabRect.right - listRect.right;
      }
      return persisted;
    }

    function setSettingsStatus(panel, key) {
      const status = panel.querySelector('[data-role="settings-status"]');
      if (status) {
        status.textContent = key ? t(key) : "";
        status.dataset.error = String(key === "settingsSaveFailed");
      }
    }

    function syncSettingsPage(panel) {
      panel.dataset.settingsOpen = String(state.settingsOpen);
      const trigger = panel.querySelector('[data-role="toggle-settings"]');
      const settings = panel.querySelector('[data-role="settings-panel"]');
      if (settings) settings.hidden = !state.settingsOpen;
      if (trigger) {
        trigger.setAttribute("aria-expanded", String(state.settingsOpen));
        const label = t(state.settingsOpen ? "closeInterfaceSettings" : "openInterfaceSettings");
        trigger.setAttribute("aria-label", label);
        trigger.setAttribute("title", label);
      }
      trigger?.setAttribute("aria-current", state.settingsOpen ? "page" : "false");
      for (const candidate of PANEL_VIEWS) {
        const active = candidate === state.activeView && !state.settingsOpen;
        const content = panel.querySelector(`[data-role="${candidate}-view"]`);
        const tab = panel.querySelector(`[data-role="view-${candidate}"]`);
        if (content) content.hidden = !active;
        if (tab) {
          tab.setAttribute("aria-selected", String(active));
          tab.setAttribute("tabindex", candidate === state.activeView ? "0" : "-1");
          tab.classList.toggle("mwi-view-tab-active", active);
        }
      }
    }

    function setSettingsOpen(panel, open, { restoreFocus = false } = {}) {
      state.settingsOpen = Boolean(open);
      syncSettingsPage(panel);
      const trigger = panel.querySelector('[data-role="toggle-settings"]');
      if (state.settingsOpen) {
        const refreshedSettings = refreshSettings(panel);
        const firstControl =
          refreshedSettings &&
          (refreshedSettings.querySelector('[data-role="settings-shrine-autofill"]') ||
            refreshedSettings.querySelector('[data-role="settings-show-construction"]') ||
            refreshedSettings.querySelector('[data-role="settings-close"]'));
        if (firstControl) {
          try {
            firstControl.focus({ preventScroll: true });
          } catch (_) {
            firstControl.focus();
          }
          if (typeof firstControl.scrollIntoView === "function")
            firstControl.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
      }
      if (restoreFocus && trigger) trigger.focus();
    }

    function setOptionalViewVisibility(panel, view, visible) {
      const construction = view === "construction";
      const stateKey = construction ? "showConstructionView" : "showTrialHistoryView";
      const statusPrefix = construction ? "constructionView" : "trialHistoryView";
      state[stateKey] = Boolean(visible);
      if (!state[stateKey] && state.activeView === view) {
        setPanelView(panel, nearestVisiblePanelView(view), { preserveSettings: true });
      }
      syncPanelViewVisibility(panel);
      const persisted = persistPluginUiState();
      setSettingsStatus(
        panel,
        persisted === false ? "settingsSaveFailed" : `${statusPrefix}${visible ? "Shown" : "Hidden"}`
      );
    }

    function updatePriceReferenceButtons(panel) {
      for (const button of panel.querySelectorAll('[data-role="price-reference"]')) {
        const active = button.dataset.priceReference === state.priceReference;
        button.dataset.active = String(active);
        button.setAttribute("aria-pressed", String(active));
      }
    }

    function maxItemUnitPriceMillionsValue() {
      return Number.isSafeInteger(state.maxConversionItemUnitPrice) && state.maxConversionItemUnitPrice > 0
        ? String(state.maxConversionItemUnitPrice / 1_000_000)
        : "";
    }

    function setMaxItemUnitPriceError(panel, key = "") {
      const input = panel.querySelector('[data-role="max-item-unit-price-millions"]');
      const error = panel.querySelector('[data-role="max-item-unit-price-error"]');
      if (!input || !error) return;
      const hasError = Boolean(key);
      input.setAttribute("aria-invalid", String(hasError));
      error.hidden = !hasError;
      error.textContent = hasError ? t(key) : "";
    }

    function parseMaxItemUnitPrice(input) {
      const rawValue = String(input.value || "").trim();
      if (!rawValue) return { valid: true, value: null };
      const millions = Number(rawValue);
      const coins = Math.round(millions * 1_000_000);
      return !Number.isFinite(millions) || millions <= 0 || !Number.isSafeInteger(coins) || coins <= 0
        ? { valid: false, value: null }
        : { valid: true, value: coins };
    }

    function applyMaxItemUnitPrice(panel, input) {
      const parsed = parseMaxItemUnitPrice(input);
      if (!parsed.valid) {
        setMaxItemUnitPriceError(panel, "maxItemUnitPriceInvalid");
        return false;
      }
      const nextValue = parsed.value;
      state.maxConversionItemUnitPrice = nextValue;
      const persisted = persistPluginUiState();
      setMaxItemUnitPriceError(panel, persisted === false ? "maxItemUnitPriceSaveFailed" : "");
      refreshPanel(panel);
      refreshGuildUpgrade(panel);
      refreshGuildExchangeAdvisor(true);
      return true;
    }

    function numberInputForStepButton(panel, button) {
      const inputRole = button.dataset.inputRole;
      const input = button.closest(".mwi-number-stepper")?.querySelector("input[data-role]");
      return input && input.dataset.role === inputRole && panel.contains(input) ? input : null;
    }

    function dispatchNumberInputChange(input) {
      const EventConstructor = input.ownerDocument.defaultView.Event;
      input.dispatchEvent(new EventConstructor("change", { bubbles: true }));
    }

    function adjustNumberInput(panel, button, { commit = true } = {}) {
      const input = numberInputForStepButton(panel, button);
      const direction = Number(button.dataset.direction);
      const step = Number(input && input.step);
      if (!input || (direction !== -1 && direction !== 1) || !Number.isFinite(step) || step <= 0) return false;

      const rawValue = String(input.value || "").trim();
      const min = input.min === "" ? null : Number(input.min);
      const max = input.max === "" ? null : Number(input.max);
      if (!rawValue) {
        if (direction < 0) return false;
        input.value = String(min !== null && Number.isFinite(min) ? min : step);
      } else {
        const current = Number(rawValue);
        if (!Number.isFinite(current)) return false;
        let next = current + direction * step;
        if (min !== null && Number.isFinite(min)) next = Math.max(min, next);
        if (max !== null && Number.isFinite(max)) next = Math.min(max, next);
        if (next === current) return false;
        input.value = String(next);
      }

      const EventConstructor = input.ownerDocument.defaultView.Event;
      input.dispatchEvent(new EventConstructor("input", { bubbles: true }));
      if (commit) dispatchNumberInputChange(input);
      return true;
    }

    function bindNumberStepperControls(panel) {
      const controls = panel;
      const view = document.defaultView;
      let activeButton = null;
      let activeInput = null;
      let activePointerId = null;
      let adjusted = false;
      let repeatDelayTimer = null;
      let repeatIntervalTimer = null;

      function clearRepeatTimers() {
        if (repeatDelayTimer !== null) view.clearTimeout(repeatDelayTimer);
        if (repeatIntervalTimer !== null) view.clearInterval(repeatIntervalTimer);
        repeatDelayTimer = null;
        repeatIntervalTimer = null;
      }

      function finishNumberStep(event = null, { commit = true } = {}) {
        if (event && activePointerId !== null && event.pointerId !== activePointerId) return;
        clearRepeatTimers();
        const input = activeInput;
        const shouldCommit = commit && adjusted && input;
        if (activeButton) delete activeButton.dataset.pressed;
        activeButton = null;
        activeInput = null;
        activePointerId = null;
        adjusted = false;
        if (shouldCommit) dispatchNumberInputChange(input);
      }

      function finishPointerStep(event) {
        if (!activeButton || (activePointerId !== null && event.pointerId !== activePointerId)) return;
        finishNumberStep(event);
      }

      function finishBlurredStep() {
        finishNumberStep();
      }

      controls.addEventListener("pointerdown", (event) => {
        const button = event.target.closest('[data-role="number-step"]');
        if (!button || button.disabled || event.button !== 0 || event.isPrimary === false) return;
        finishNumberStep();
        event.preventDefault();
        activeButton = button;
        activeInput = numberInputForStepButton(panel, button);
        activePointerId = event.pointerId;
        button.dataset.pressed = "true";
        try {
          button.focus({ preventScroll: true });
        } catch (_) {
          button.focus();
        }
        try {
          button.setPointerCapture(event.pointerId);
        } catch (_) {
          // Synthetic events and older browsers can reject pointer capture; local listeners still handle release.
        }
        adjusted = adjustNumberInput(panel, button, { commit: false });
        repeatDelayTimer = view.setTimeout(() => {
          repeatDelayTimer = null;
          repeatIntervalTimer = view.setInterval(() => {
            adjusted = adjustNumberInput(panel, button, { commit: false }) || adjusted;
          }, NUMBER_STEP_REPEAT_INTERVAL_MS);
        }, NUMBER_STEP_REPEAT_DELAY_MS);
      });

      controls.addEventListener("lostpointercapture", finishPointerStep);
      controls.addEventListener("contextmenu", (event) => {
        if (event.target.closest('[data-role="number-step"]')) event.preventDefault();
      });
      controls.addEventListener("click", (event) => {
        const button = event.target.closest('[data-role="number-step"]');
        if (!button || event.detail !== 0) return;
        adjustNumberInput(panel, button);
      });
      view.addEventListener("pointerup", finishPointerStep, true);
      view.addEventListener("pointercancel", finishPointerStep, true);
      view.addEventListener("blur", finishBlurredStep);

      return () => {
        finishNumberStep();
        view.removeEventListener("pointerup", finishPointerStep, true);
        view.removeEventListener("pointercancel", finishPointerStep, true);
        view.removeEventListener("blur", finishBlurredStep);
      };
    }

    function createPanel() {
      const savedActiveView = state.activeView;
      normalizedPanelOrder();
      if (!panelViewEnabled(state.activeView)) state.activeView = nearestVisiblePanelView(state.activeView);
      const panel = document.createElement("section");
      panel.id = "mwi-credit-optimizer";
      panel.dataset.activeView = state.activeView;
      panel.innerHTML = `
        <style>
          ${stylesApi.PANEL_STYLES}
        </style>
        <h3>${escapeHtml(t("panelTitle"))}</h3>
        <div class="mwi-plugin-version" data-role="version-status" aria-live="polite"></div>
        <div class="mwi-view-tabs-shell">
          <div class="mwi-view-tabs" role="tablist" aria-label="${escapeHtml(t("panelViewOrder"))}">${renderPanelTabs()}</div>
          <button class="mwi-settings-trigger" data-role="toggle-settings" type="button" aria-expanded="${String(state.settingsOpen)}" aria-controls="mwi-settings-panel" aria-label="${escapeHtml(t(state.settingsOpen ? "closeInterfaceSettings" : "openInterfaceSettings"))}" title="${escapeHtml(t(state.settingsOpen ? "closeInterfaceSettings" : "openInterfaceSettings"))}">${escapeHtml(t("interfaceSettings"))}</button>
        </div>
        ${renderSettingsMarkup()}
        <div id="mwi-view-panel-credit" data-role="credit-view" role="tabpanel" aria-labelledby="mwi-view-tab-credit"${state.activeView === "credit" ? "" : " hidden"}>
          <div class="mwi-controls">
            <div class="mwi-number-field"><label for="mwi-target-credit">${escapeHtml(t("targetCredits"))}</label><span class="mwi-number-stepper mwi-target-credit-stepper"><input id="mwi-target-credit" data-role="target" type="number" min="1" step="100" inputmode="numeric" value="${state.targetCredit}"><span class="mwi-stepper-buttons"><button class="mwi-stepper-button mwi-stepper-up" data-role="number-step" data-input-role="target" data-direction="1" type="button" aria-label="${escapeHtml(t("increaseTargetCredits"))}" title="${escapeHtml(t("increaseTargetCredits"))}"><svg viewBox="0 0 16 10" aria-hidden="true"><path d="M2 8 8 2l6 6"></path></svg></button><button class="mwi-stepper-button mwi-stepper-down" data-role="number-step" data-input-role="target" data-direction="-1" type="button" aria-label="${escapeHtml(t("decreaseTargetCredits"))}" title="${escapeHtml(t("decreaseTargetCredits"))}"><svg viewBox="0 0 16 10" aria-hidden="true"><path d="M2 2l6 6 6-6"></path></svg></button></span></span></div>
            <div class="mwi-price-reference" role="group" aria-label="${escapeHtml(t("marketReference"))}"><span class="mwi-price-reference-label">${escapeHtml(t("priceReference"))}</span><button data-role="price-reference" data-price-reference="a" type="button">${escapeHtml(priceReference("a").label)}</button><button data-role="price-reference" data-price-reference="b" type="button">${escapeHtml(priceReference("b").label)}</button></div>
            <button data-role="refresh" type="button">${escapeHtml(t("refreshEstimate"))}</button>
            <div class="mwi-price-limit-control">
              <div class="mwi-price-limit"><span>${escapeHtml(t("maxItemUnitPricePrefix"))}</span><span class="mwi-number-stepper mwi-price-limit-stepper"><input data-role="max-item-unit-price-millions" type="number" min="10" step="10" inputmode="decimal" value="${escapeHtml(maxItemUnitPriceMillionsValue())}" placeholder="${escapeHtml(t("maxItemUnitPricePlaceholder"))}" aria-label="${escapeHtml(t("maxItemUnitPriceInput"))}" aria-describedby="mwi-max-item-unit-price-error" aria-invalid="false"><span class="mwi-stepper-buttons"><button class="mwi-stepper-button mwi-stepper-up" data-role="number-step" data-input-role="max-item-unit-price-millions" data-direction="1" type="button" aria-label="${escapeHtml(t("increaseMaxItemUnitPrice"))}" title="${escapeHtml(t("increaseMaxItemUnitPrice"))}"><svg viewBox="0 0 16 10" aria-hidden="true"><path d="M2 8 8 2l6 6"></path></svg></button><button class="mwi-stepper-button mwi-stepper-down" data-role="number-step" data-input-role="max-item-unit-price-millions" data-direction="-1" type="button" aria-label="${escapeHtml(t("decreaseMaxItemUnitPrice"))}" title="${escapeHtml(t("decreaseMaxItemUnitPrice"))}"><svg viewBox="0 0 16 10" aria-hidden="true"><path d="M2 2l6 6 6-6"></path></svg></button></span></span><span>${escapeHtml(t("maxItemUnitPriceSuffix"))}</span></div>
              <small id="mwi-max-item-unit-price-error" class="mwi-price-limit-error" data-role="max-item-unit-price-error" role="status" aria-live="polite" hidden></small>
            </div>
          </div>
          <div class="mwi-status" data-role="status">${escapeHtml(t("waitingExchangeRules"))}</div>
          <div data-role="results"></div>
        </div>
        <div id="mwi-view-panel-upgrade" data-role="upgrade-view" role="tabpanel" aria-labelledby="mwi-view-tab-upgrade"${state.activeView === "upgrade" ? "" : " hidden"}>
          <section class="mwi-upgrade-planner" aria-label="${escapeHtml(t("guildShrineBatchPlan"))}">
            <div class="mwi-upgrade-preset">
              <div class="mwi-upgrade-preset-copy"><strong>${escapeHtml(t("guildShrineBatchPlan"))}</strong><small data-role="guild-shrine-target-status" role="status" aria-live="polite">${escapeHtml(t("shrineLevelsReading"))}</small></div>
              <div class="mwi-upgrade-preset-buttons"><button data-role="set-guild-shrine-target" data-domain="life" type="button">${escapeHtml(t("setGuildLifeTarget"))}</button><button data-role="set-guild-shrine-target" data-domain="combat" type="button">${escapeHtml(t("setGuildCombatTarget"))}</button></div>
            </div>
            <div class="mwi-upgrade-plan-list" data-role="upgrade-plan-list"></div>
            <div class="mwi-upgrade-actions"><small data-role="upgrade-plan-count">${escapeHtml(t("selectedUpgradePlanCount", { count: "0" }))}</small><span><button data-role="add-upgrade-plan" type="button">＋ ${escapeHtml(t("addShrine"))}</button><button class="mwi-clear-upgrade-plans" data-role="clear-upgrade-plans" type="button">${escapeHtml(t("clearAll"))}</button></span></div>
          </section>
          <section class="mwi-shrine-guide-route" data-role="shrine-guide-route" data-active="${String(state.shrineGuideEnabled)}" data-status="inactive" aria-live="polite">
            <button class="mwi-shrine-guide-toggle" data-role="toggle-shrine-guide" type="button" aria-pressed="${String(state.shrineGuideEnabled)}"><span class="mwi-shrine-guide-beacon" aria-hidden="true"></span><span>${escapeHtml(state.shrineGuideEnabled ? t("guideDisable") : t("guideEnable"))}</span></button>
            <span class="mwi-shrine-guide-copy"><strong data-role="shrine-guide-title">${escapeHtml(t("guideReady"))}</strong><small data-role="shrine-guide-detail"></small></span>
          </section>
          ${renderGuildTokenBudgetControl()}
          ${renderGuildTokenCreditPlanToggle()}
          <div class="mwi-status" data-role="upgrade-status">${escapeHtml(t("waitingUpgradeRules"))}</div>
          <div data-role="upgrade-results"></div>
        </div>
        <div id="mwi-view-panel-construction" data-role="construction-view" role="tabpanel" aria-labelledby="mwi-view-tab-construction"${state.activeView === "construction" ? "" : " hidden"}>
          <div class="mwi-status mwi-construction-status" data-role="construction-status" hidden><span data-role="construction-status-text" role="status" aria-live="polite" aria-atomic="true"></span><button data-role="undo-clear-building-plans" type="button" hidden>${escapeHtml(t("undoClearBuildingPlans"))}</button></div>
          <div data-role="construction-results"></div>
        </div>
        <div id="mwi-view-panel-trials" data-role="trials-view" role="tabpanel" aria-labelledby="mwi-view-tab-trials"${state.activeView === "trials" ? "" : " hidden"}></div>
        <footer class="mwi-plugin-footer">${escapeHtml(t("author"))}<br>${escapeHtml(t("support"))}<br><a href="${escapeHtml(FALLBACK_INSTALL_URL)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t("fallbackInstaller"))}</a></footer>`;
      panel.querySelector('[data-role="refresh"]').addEventListener("click", () => refreshPanel(panel, true));
      const numberStepperCleanup = bindNumberStepperControls(panel);
      panel.__mwiNumberStepperCleanup = numberStepperCleanup;
      numberStepperCleanups.push(numberStepperCleanup);
      panel.querySelector('[data-role="target"]').addEventListener("change", (event) => {
        const target = Number(event.target.value);
        if (Number.isSafeInteger(target) && target > 0) state.targetCredit = target;
        else event.target.value = String(state.targetCredit);
        persistPluginUiState();
        refreshPanel(panel);
      });
      const maxItemUnitPriceInput = panel.querySelector('[data-role="max-item-unit-price-millions"]');
      maxItemUnitPriceInput.addEventListener("input", (event) => {
        setMaxItemUnitPriceError(panel, parseMaxItemUnitPrice(event.target).valid ? "" : "maxItemUnitPriceInvalid");
      });
      maxItemUnitPriceInput.addEventListener("change", (event) => {
        applyMaxItemUnitPrice(panel, event.target);
      });
      maxItemUnitPriceInput.addEventListener("blur", (event) => {
        const inputValue = String(event.target.value || "").trim();
        if (inputValue === maxItemUnitPriceMillionsValue() && event.target.getAttribute("aria-invalid") !== "true")
          return;
        applyMaxItemUnitPrice(panel, event.target);
      });
      const settingsTrigger = panel.querySelector('[data-role="toggle-settings"]');
      const settingsPanel = panel.querySelector('[data-role="settings-panel"]');
      settingsTrigger.addEventListener("click", () => setSettingsOpen(panel, !state.settingsOpen));
      settingsPanel.querySelector('[data-role="settings-close"]').addEventListener("click", () => {
        setSettingsOpen(panel, false, { restoreFocus: true });
      });
      settingsPanel.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !state.settingsOpen) return;
        event.preventDefault();
        event.stopPropagation();
        setSettingsOpen(panel, false, { restoreFocus: true });
      });
      function saveSidebarName(reset = false) {
        const input = settingsPanel.querySelector('[data-role="settings-sidebar-name"]');
        state.sidebarDisplayName = normalizeSidebarDisplayName(reset ? "" : input.value);
        if (state.creditTab) state.creditTab.textContent = state.sidebarDisplayName || t("sidebarCredit");
        const persisted = persistPluginUiState();
        input.value = state.sidebarDisplayName;
        setSettingsStatus(panel, persisted === false ? "settingsSaveFailed" : "settingsSaved");
      }
      settingsPanel.addEventListener("submit", (event) => {
        if (!event.target.matches('[data-role="settings-sidebar-name-form"]')) return;
        event.preventDefault();
        saveSidebarName();
      });
      settingsPanel.addEventListener("click", (event) => {
        if (event.target.closest('[data-role="settings-sidebar-name-reset"]')) saveSidebarName(true);
      });
      settingsPanel.addEventListener("change", (event) => {
        if (event.target.matches('[data-role="settings-shrine-autofill"]')) {
          const guildBuffHrid = event.target.dataset.guildBuffHrid;
          if (!guildBuffEntries().some((entry) => entry.hrid === guildBuffHrid)) return;
          if (event.target.checked) state.guildShrineAutofillExcludedBuffHrids.delete(guildBuffHrid);
          else state.guildShrineAutofillExcludedBuffHrids.add(guildBuffHrid);
          const persisted = persistPluginUiState();
          setSettingsStatus(panel, persisted === false ? "settingsSaveFailed" : "settingsSaved");
          if (state.activeView === "upgrade") refreshGuildUpgrade(panel);
          return;
        }
        if (event.target.matches('[data-role="settings-show-construction"]')) {
          setOptionalViewVisibility(panel, "construction", event.target.checked);
        }
        if (event.target.matches('[data-role="settings-show-trials"]')) {
          setOptionalViewVisibility(panel, "trials", event.target.checked);
        }
      });
      panel.querySelector(".mwi-price-reference").addEventListener("click", (event) => {
        const button = event.target.closest('[data-role="price-reference"]');
        if (!button || button.dataset.priceReference === state.priceReference) return;
        setPriceReference(button.dataset.priceReference);
        updatePriceReferenceButtons(panel);
        refreshPanel(panel);
        refreshGuildUpgrade(panel);
        refreshGuildExchangeAdvisor();
      });
      updatePriceReferenceButtons(panel);
      panel.querySelector('[data-role="results"]').addEventListener("click", (event) => {
        const target = event.target && (event.target.nodeType === 1 ? event.target : event.target.parentElement);
        if (!target) return;
        const tokenToggle = target.closest('[data-role="toggle-token-values"]');
        if (tokenToggle) {
          const tokenSection = tokenToggle.closest(".mwi-token-value-section");
          const tokenBody = tokenSection && tokenSection.querySelector(".mwi-token-value-body");
          if (!tokenSection || !tokenBody) return;
          state.guildTokenValuesCollapsed = !state.guildTokenValuesCollapsed;
          tokenSection.dataset.collapsed = String(state.guildTokenValuesCollapsed);
          tokenToggle.setAttribute("aria-expanded", String(!state.guildTokenValuesCollapsed));
          const tokenIcon = tokenToggle.querySelector(".mwi-collapse-icon");
          if (tokenIcon) tokenIcon.textContent = state.guildTokenValuesCollapsed ? "▸" : "▾";
          tokenBody.hidden = state.guildTokenValuesCollapsed;
          persistPluginUiState();
          return;
        }
        const toggle = target.closest('[data-role="toggle-credit-section"]');
        const section = toggle && toggle.closest("[data-credit-item-hrid]");
        if (!section) return;
        const creditItemHrid = section.dataset.creditItemHrid;
        const collapsed = !state.collapsedCreditSections.has(creditItemHrid);
        if (collapsed) state.collapsedCreditSections.add(creditItemHrid);
        else state.collapsedCreditSections.delete(creditItemHrid);
        section.dataset.collapsed = String(collapsed);
        toggle.setAttribute("aria-expanded", String(!collapsed));
        const icon = toggle.querySelector(".mwi-collapse-icon");
        if (icon) icon.textContent = collapsed ? "▸" : "▾";
        const body = section.querySelector(".mwi-credit-body");
        if (body) body.hidden = collapsed;
        persistPluginUiState();
      });
      bindTrialHistory(panel);
      panel.querySelector('[data-role="view-trials"]').addEventListener("click", () => setPanelView(panel, "trials"));
      panel.querySelector('[data-role="view-credit"]').addEventListener("click", () => setPanelView(panel, "credit"));
      panel.querySelector('[data-role="view-upgrade"]').addEventListener("click", () => setPanelView(panel, "upgrade"));
      panel
        .querySelector('[data-role="view-construction"]')
        .addEventListener("click", () => setPanelView(panel, "construction"));
      panel.querySelector(".mwi-view-tabs").addEventListener("keydown", (event) => {
        if (event.altKey) return;
        const tabs = Array.from(panel.querySelectorAll(".mwi-view-tab-item:not([hidden]) .mwi-view-tab"));
        const current = event.target.closest(".mwi-view-tab");
        const index = tabs.indexOf(current);
        if (index < 0) return;
        let nextIndex = index;
        if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
        else if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = tabs.length - 1;
        else return;
        event.preventDefault();
        tabs[nextIndex].focus();
        setPanelView(panel, tabs[nextIndex].dataset.role.replace("view-", ""));
      });
      const constructionResults = panel.querySelector('[data-role="construction-results"]');
      constructionResults.addEventListener("input", (event) => {
        if (event.target.matches('[data-role="guild-point-budget"]')) {
          const parsed = guildPointBudgetInputValue(event.target);
          setGuildPointBudgetValidity(panel, event.target, parsed.valid);
          if (!parsed.valid) return;
          state.manualGuildPoints = parsed.value;
          clearConstructionNotice(panel);
          refreshGuildConstructionBudgetPreview(panel);
          return;
        }
        if (event.target.matches('[data-role="building-search"]')) {
          state.buildingSearch = event.target.value;
          applyGuildBuildingFilters(constructionResults);
        }
      });
      constructionResults.addEventListener("change", (event) => {
        if (event.target.matches('[data-role="guild-point-forecast-weeks"]')) {
          const weeks = Number(event.target.value);
          state.guildPointForecastWeeks = Number.isSafeInteger(weeks) && weeks >= 2 && weeks <= 12 ? weeks : 6;
          clearConstructionNotice(panel);
          persistGuildBuildingPlannerState();
          refreshConstructionAndFocus(panel, { role: "guild-point-forecast-weeks" }, null);
          return;
        }
        if (event.target.matches('[data-role="guild-point-planning-weeks"]')) {
          const weeks = Number(event.target.value);
          state.guildPointPlanningWeeks = Number.isSafeInteger(weeks) && weeks >= 0 && weeks <= 12 ? weeks : 0;
          clearConstructionNotice(panel);
          persistGuildBuildingPlannerState();
          refreshConstructionAndFocus(panel, { role: "guild-point-planning-weeks" }, null);
          return;
        }
        if (event.target.matches('[data-role="guild-point-budget"]')) {
          const parsed = guildPointBudgetInputValue(event.target);
          setGuildPointBudgetValidity(panel, event.target, parsed.valid);
          if (!parsed.valid) return;
          const needsPreview = state.manualGuildPoints !== parsed.value;
          state.manualGuildPoints = parsed.value;
          clearConstructionNotice(panel);
          persistGuildBuildingPlannerState();
          // Input already refreshed the preview. Preserve the control receiving
          // the blur/click so committing a budget does not swallow that click.
          if (needsPreview) refreshGuildConstructionBudgetPreview(panel);
          return;
        }
        if (event.target.matches('[data-role="building-search"]')) {
          state.buildingSearch = event.target.value;
          applyGuildBuildingFilters(constructionResults);
          return;
        }
        if (event.target.matches('[data-role="building-target"]')) {
          const buildingHrid = event.target.dataset.buildingHrid;
          setGuildBuildingTarget(guildBuildingDefinitions(), buildingHrid, Number(event.target.value));
          refreshConstructionAndFocus(panel, { role: "building-target", buildingHrid });
        }
      });
      constructionResults.addEventListener("keydown", (event) => {
        const trackedEditDialog = event.target.closest('[data-role="tracked-guild-point-edit-dialog"]');
        if (trackedEditDialog) {
          if (event.key === "Escape") {
            event.preventDefault();
            const weekStartAt = constructionView.cancelTrackedGuildPointEditWarning();
            refreshConstructionAndFocus(panel, { role: "edit-tracked-guild-point-week", weekStartAt });
            return;
          }
          if (event.key === "Tab") {
            const controls = Array.from(trackedEditDialog.querySelectorAll("button:not([disabled])"));
            if (!controls.length) return;
            const currentIndex = controls.indexOf(document.activeElement);
            const nextIndex = event.shiftKey
              ? currentIndex <= 0
                ? controls.length - 1
                : currentIndex - 1
              : currentIndex < 0 || currentIndex >= controls.length - 1
                ? 0
                : currentIndex + 1;
            event.preventDefault();
            controls[nextIndex].focus();
          }
          return;
        }
        if (event.key !== "Escape" || !event.target.closest(".mwi-building-picker-body")) return;
        event.preventDefault();
        setGuildBuildingPickerOpen(false);
        refreshConstructionAndFocus(panel, { role: "toggle-building-picker" });
      });
      constructionResults.addEventListener(
        "toggle",
        (event) => {
          if (event.target.matches(".mwi-guild-point-history"))
            constructionView.setGuildPointHistoryOpen(event.target.open);
        },
        true
      );
      constructionResults.addEventListener("click", (event) => {
        // Native toggle is queued; preserve the intended state before a refresh can replace the node.
        const disclosure = event.target.closest("summary")?.parentElement;
        if (!event.defaultPrevented && disclosure?.matches(".mwi-guild-point-history"))
          constructionView.setGuildPointHistoryOpen(!disclosure.open);
        const button = event.target.closest("button");
        if (!button) return;
        const definitions = guildBuildingDefinitions();
        if (button.matches('[data-role="toggle-building-picker"]')) {
          const open = button.getAttribute("aria-expanded") !== "true";
          setGuildBuildingPickerOpen(open);
          refreshConstructionAndFocus(panel, { role: open ? "building-search" : "toggle-building-picker" });
          return;
        }
        if (button.matches('[data-role="building-tile"]')) {
          const buildingHrid = button.dataset.buildingHrid;
          const result = addGuildBuildingPlan(definitions, buildingHrid);
          if (result.status === "added") {
            refreshConstructionAndFocus(panel, { role: "building-target", buildingHrid });
            return;
          }
          if (result.status === "already_planned") {
            focusConstructionControl(panel, { role: "building-target", buildingHrid });
            return;
          }
          return;
        }
        if (button.matches('[data-role="building-category"]')) {
          state.buildingCategory = button.dataset.category;
          persistGuildBuildingPlannerState();
          applyGuildBuildingFilters(constructionResults);
          return;
        }
        if (button.matches('[data-role="adjust-building-target"]')) {
          const definition = definitions.find((entry) => entry.hrid === button.dataset.buildingHrid);
          if (!definition) return;
          const existing = state.buildingPlans.find((plan) => plan.buildingHrid === definition.hrid);
          if (!existing) return;
          const delta = Number(button.dataset.delta || 0);
          const targetLevel = Math.min(definition.maxLevel, existing.targetLevel + delta);
          setGuildBuildingTarget(definitions, definition.hrid, targetLevel);
          refreshConstructionAndFocus(
            panel,
            { role: "adjust-building-target", buildingHrid: definition.hrid, delta },
            { role: "building-target", buildingHrid: definition.hrid }
          );
          return;
        }
        if (button.matches('[data-role="remove-building-plan"]')) {
          const result = removeGuildBuildingPlan(definitions, button.dataset.buildingHrid);
          if (result.status !== "removed") return;
          const neighbor = state.buildingPlans[Math.min(result.removedIndex, state.buildingPlans.length - 1)];
          refreshConstructionAndFocus(
            panel,
            neighbor
              ? { role: "building-target", buildingHrid: neighbor.buildingHrid }
              : { role: "toggle-building-picker" }
          );
          return;
        }
        if (button.matches('[data-role="move-building-plan"]')) {
          const buildingHrid = button.dataset.buildingHrid;
          if (moveGuildBuildingPlan(buildingHrid, Number(button.dataset.direction)))
            refreshConstructionAndFocus(panel, { role: "construction-drag-handle", buildingHrid });
          return;
        }
        if (button.matches('[data-role="toggle-building-steps"]')) {
          const buildingHrid = button.dataset.buildingHrid;
          const definition = definitions.find((entry) => entry.hrid === buildingHrid);
          if (!definition) return;
          const expanded = toggleGuildBuildingSteps(buildingHrid);
          const group = button.closest(".mwi-construction-group");
          const details = group && group.querySelector(".mwi-construction-group-steps");
          if (group) group.dataset.expanded = String(expanded);
          if (details) details.hidden = !expanded;
          button.setAttribute("aria-expanded", String(expanded));
          button.setAttribute(
            "aria-label",
            t(expanded ? "collapseBuildingSteps" : "expandBuildingSteps", {
              building: definitions.find((entry) => entry.hrid === buildingHrid)?.nameKey
                ? t(definition.nameKey)
                : buildingHrid
            })
          );
          button.setAttribute("title", button.getAttribute("aria-label"));
          const icon = button.querySelector("span");
          if (icon) icon.textContent = expanded ? "▴" : "▾";
          return;
        }
        if (button.matches('[data-role="clear-building-plans"]')) {
          if (
            clearGuildBuildingPlans(() => {
              const undo = panel.querySelector('[data-role="undo-clear-building-plans"]');
              if (!undo) return;
              if (document.activeElement === undo) {
                const restored = focusConstructionControl(panel, { role: "toggle-building-picker" });
                if (!restored) panel.querySelector('[data-role="view-construction"]')?.focus();
              }
              undo.hidden = true;
            })
          )
            refreshConstructionAndFocus(panel, { role: "undo-clear-building-plans" });
          return;
        }
        if (button.matches('[data-role="copy-building-plan"]')) {
          void copyGuildConstructionPlan(panel).then(() => {
            if (state.activeView !== "construction") return;
            if (document.activeElement && document.activeElement !== document.body) return;
            focusConstructionControl(panel, { role: "copy-building-plan" });
          });
          return;
        }
        if (button.matches('[data-role="export-building-plan"]')) {
          exportGuildConstructionCsv();
          return;
        }
        if (button.matches('[data-role="export-guild-point-history"]')) {
          exportGuildPointHistoryCsv();
          return;
        }
        if (button.matches('[data-role="edit-tracked-guild-point-week"]')) {
          const weekStartAt = Number(button.dataset.weekStartAt);
          if (!constructionView.openTrackedGuildPointEditWarning(weekStartAt)) return;
          refreshConstructionAndFocus(panel, { role: "confirm-tracked-guild-point-edit", weekStartAt });
          return;
        }
        if (button.matches('[data-role="cancel-tracked-guild-point-edit"]')) {
          const weekStartAt = constructionView.cancelTrackedGuildPointEditWarning();
          refreshConstructionAndFocus(panel, { role: "edit-tracked-guild-point-week", weekStartAt });
          return;
        }
        if (button.matches('[data-role="confirm-tracked-guild-point-edit"]')) {
          const weekStartAt = constructionView.confirmTrackedGuildPointEditWarning();
          refreshConstructionAndFocus(panel, { role: "manual-guild-point-earned", weekStartAt });
          return;
        }
        if (button.matches('[data-role="save-manual-guild-point-history"]')) {
          const form = button.closest('[data-role="manual-guild-point-form"]');
          const inputs = form ? Array.from(form.querySelectorAll('[data-role="manual-guild-point-earned"]')) : [];
          const invalid = inputs.find((input) => !input.reportValidity());
          if (invalid) {
            invalid.focus();
            return;
          }
          const result = constructionView.saveManualGuildPointHistory(
            inputs.map((input) => ({
              weekStartAt: input.dataset.weekStartAt,
              earnedPoints: input.value,
              trackedOriginalPoints: input.dataset.trackedOriginalPoints
            }))
          );
          refreshConstructionAndFocus(
            panel,
            result.status === "saved"
              ? { role: "save-manual-guild-point-history" }
              : { role: "manual-guild-point-earned", weekStartAt: result.weekStartAt }
          );
          return;
        }
        if (button.matches('[data-role="reset-guild-point-history"]')) resetGuildPointHistory(panel);
      });
      panel.querySelector('[data-role="undo-clear-building-plans"]').addEventListener("click", () => {
        if (!undoClearGuildBuildingPlans()) return;
        const firstPlan = state.buildingPlans[0];
        refreshConstructionAndFocus(
          panel,
          firstPlan
            ? { role: "building-target", buildingHrid: firstPlan.buildingHrid }
            : { role: "toggle-building-picker" }
        );
      });
      panel.addEventListener("click", (event) => {
        const modeButton = event.target.closest('[data-role="toggle-credit-token-mode"]');
        if (modeButton) {
          const creditItemHrid = modeButton.dataset.creditHrid;
          if (!CREDIT_TYPES.some(([hrid]) => hrid === creditItemHrid)) return;
          if (state.guildTokenCreditHrids.has(creditItemHrid)) state.guildTokenCreditHrids.delete(creditItemHrid);
          else state.guildTokenCreditHrids.add(creditItemHrid);
          updateGuildTokenCreditPlanButton(panel);
          persistPluginUiState();
          refreshGuildUpgrade(panel);
          return;
        }
        const button = event.target.closest('[data-role="market-item-link"]');
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        openMarketplaceForItem(button.dataset.itemHrid, button.dataset.itemName);
      });
      panel.querySelector('[data-role="add-upgrade-plan"]').addEventListener("click", () => {
        addGuildUpgradePlan(guildBuffEntries());
        persistPluginUiState();
        refreshGuildUpgrade(panel);
      });
      panel.querySelector('[data-role="clear-upgrade-plans"]').addEventListener("click", () => {
        clearGuildUpgradePlans();
        persistPluginUiState();
        refreshGuildUpgrade(panel);
      });
      panel
        .querySelector('[data-role="toggle-shrine-guide"]')
        .addEventListener("click", () => setShrineGuideEnabled(panel, !state.shrineGuideEnabled));
      const guildTokenBudgetControl = panel.querySelector('[data-role="guild-token-budget-control"]');
      const guildTokenBudgetRange = panel.querySelector('[data-role="guild-token-budget-range"]');
      guildTokenBudgetControl.addEventListener("input", (event) => {
        if (!event.target.matches('[data-role="guild-token-budget-range"], [data-role="guild-token-budget-number"]'))
          return;
        const snap = event.target === guildTokenBudgetRange && guildTokenBudgetRange.dataset.dragging === "true";
        setGuildTokenBudget(panel, event.target.value, { snap });
      });
      guildTokenBudgetRange.addEventListener("pointerdown", () => {
        guildTokenBudgetRange.dataset.dragging = "true";
      });
      for (const eventName of ["pointerup", "pointercancel", "blur"]) {
        guildTokenBudgetRange.addEventListener(eventName, () => {
          guildTokenBudgetRange.dataset.dragging = "false";
        });
      }
      const guildTokenCreditPlanToggle = panel.querySelector('[data-role="toggle-guild-token-credit-plan"]');
      if (guildTokenCreditPlanToggle) {
        guildTokenCreditPlanToggle.addEventListener("click", () => {
          const selectAll = !guildTokenCreditSelectionState().allSelected;
          state.guildTokenCreditHrids = new Set(selectAll ? CREDIT_TYPES.map(([hrid]) => hrid) : []);
          updateGuildTokenCreditPlanButton(panel);
          persistPluginUiState();
          refreshGuildUpgrade(panel);
        });
      }
      panel.querySelector(".mwi-upgrade-preset-buttons").addEventListener("click", (event) => {
        const button = event.target.closest('[data-role="set-guild-shrine-target"]');
        if (!button || button.disabled) return;
        if (!applyGuildShrineTargets(guildBuffEntries(), button.dataset.domain)) return;
        persistPluginUiState();
        refreshGuildUpgrade(panel);
      });
      panel.querySelector('[data-role="upgrade-plan-list"]').addEventListener("change", (event) => {
        const row = event.target.closest("[data-plan-id]");
        const plan = row && state.upgradePlans.find((candidate) => candidate.id === row.dataset.planId);
        if (!plan) return;
        const entries = guildBuffEntries();
        if (event.target.matches('[data-role="plan-buff"]')) {
          const targetHrid = event.target.value;
          if (
            state.upgradePlans.some((candidate) => candidate.id !== plan.id && candidate.guildBuffHrid === targetHrid)
          )
            return;
          const entry = entries.find((candidate) => candidate.hrid === targetHrid);
          if (!entry || currentGuildBuffLevel(entry) >= entry.maxLevel) return;
          plan.guildBuffHrid = entry.hrid;
          plan.collapsed = false;
          plan.startLevel = currentGuildBuffLevel(entry);
          plan.targetLevel = Math.min(plan.startLevel + 1, entry.maxLevel);
        } else if (event.target.matches('[data-role="plan-start"]')) {
          plan.startLevel = Number(event.target.value);
          const entry = entries.find((candidate) => candidate.hrid === plan.guildBuffHrid);
          plan.targetLevel = Math.max(plan.startLevel + 1, Math.min(plan.targetLevel, entry.maxLevel));
        } else if (event.target.matches('[data-role="plan-target"]')) {
          plan.targetLevel = Number(event.target.value);
        }
        state.upgradePresetNotice = "";
        persistPluginUiState();
        refreshGuildUpgrade(panel);
      });
      panel.querySelector('[data-role="upgrade-plan-list"]').addEventListener("click", (event) => {
        const collapseButton = event.target.closest('[data-role="toggle-plan"]');
        if (collapseButton) {
          const row = collapseButton.closest("[data-plan-id]");
          const plan = state.upgradePlans.find((candidate) => candidate.id === row.dataset.planId);
          if (plan) {
            plan.collapsed = plan.collapsed !== true;
            persistPluginUiState();
            refreshGuildUpgrade(panel);
          }
          return;
        }
        const targetButton = event.target.closest('[data-role="shrine-target-next"],[data-role="shrine-target-cap"]');
        if (targetButton && !targetButton.disabled) {
          const row = targetButton.closest("[data-plan-id]");
          const select = row.querySelector('[data-role="plan-target"]');
          const start = Number(row.querySelector('[data-role="plan-start"]').value);
          const entry = guildBuffEntries().find((candidate) => candidate.hrid === row.dataset.guildBuffHrid);
          const cap =
            targetButton.dataset.role === "shrine-target-cap" ? Number(targetButton.dataset.targetLevel) : start + 1;
          if (entry && Number.isSafeInteger(cap) && cap > start && cap <= entry.maxLevel) {
            select.value = String(cap);
            select.dispatchEvent(new Event("change", { bubbles: true }));
            row.isConnected && targetButton.focus({ preventScroll: true });
          }
          return;
        }
        const button = event.target.closest('[data-role="remove-plan"]');
        const row = button && button.closest("[data-plan-id]");
        if (!row) return;
        if (!removeGuildUpgradePlan(row.dataset.planId)) return;
        persistPluginUiState();
        refreshGuildUpgrade(panel);
      });
      const tabSortable = sortableApi.createPointerSortable({
        root: panel,
        containerSelector: ".mwi-view-tabs",
        itemSelector: ".mwi-view-tab-item:not([hidden])",
        handleSelector: ".mwi-view-tab-item:not([hidden])",
        axis: "x",
        onCommit: ({ key, toIndex }) => reorderPanelView(panel, key, toIndex)
      });
      const constructionSortable = sortableApi.createPointerSortable({
        root: panel,
        containerSelector: '[data-role="construction-sort-list"]',
        itemSelector: ".mwi-construction-group",
        handleSelector: ".mwi-construction-drag-handle",
        axis: "y",
        onCommit: ({ key, toIndex }) => {
          if (!reorderGuildBuildingPlan(key, toIndex)) return;
          refreshConstructionAndFocus(panel, { role: "construction-drag-handle", buildingHrid: key });
        }
      });
      panel.__mwiSortableControllers = [tabSortable, constructionSortable];
      sortableControllers.push(tabSortable, constructionSortable);
      if (state.activeView !== savedActiveView) persistPluginUiState();
      syncSettingsPage(panel);
      checkPluginUpdate(panel);
      return panel;
    }

    function destroyPanel(panel) {
      const numberStepperCleanup = panel && panel.__mwiNumberStepperCleanup;
      if (numberStepperCleanup) {
        const cleanupIndex = numberStepperCleanups.indexOf(numberStepperCleanup);
        if (cleanupIndex >= 0) numberStepperCleanups.splice(cleanupIndex, 1);
        numberStepperCleanup();
        delete panel.__mwiNumberStepperCleanup;
      }
      const controllers = Array.isArray(panel && panel.__mwiSortableControllers) ? panel.__mwiSortableControllers : [];
      for (const controller of controllers) {
        const index = sortableControllers.indexOf(controller);
        if (index >= 0) sortableControllers.splice(index, 1);
        controller.destroy();
      }
      if (panel) delete panel.__mwiSortableControllers;
    }

    function recreatePanel(previousPanel) {
      const active = previousPanel && previousPanel.contains(document.activeElement) ? document.activeElement : null;
      const focusSnapshot = active
        ? { id: active.id || "", role: active.dataset.role || "", dataset: { ...active.dataset } }
        : null;
      const scrollTop = previousPanel ? previousPanel.scrollTop : 0;
      destroyPanel(previousPanel);
      if (previousPanel) previousPanel.remove();
      const panel = createPanel();
      Promise.resolve().then(() => {
        if (!panel.isConnected) return;
        panel.scrollTop = scrollTop;
        if (!focusSnapshot) return;
        const candidates = Array.from(panel.querySelectorAll(focusSnapshot.role ? "[data-role]" : "[id]"));
        const target = candidates.find((candidate) => {
          if (focusSnapshot.role && candidate.dataset.role !== focusSnapshot.role) return false;
          if (!focusSnapshot.role && candidate.id !== focusSnapshot.id) return false;
          return Object.entries(focusSnapshot.dataset).every(([key, value]) => candidate.dataset[key] === value);
        });
        if (!target || target.disabled || target.closest("[hidden]")) return;
        try {
          target.focus({ preventScroll: true });
        } catch (_) {
          target.focus();
        }
      });
      return panel;
    }

    function dispose() {
      for (const cleanup of numberStepperCleanups.splice(0)) cleanup();
      for (const controller of sortableControllers.splice(0)) controller.destroy();
    }

    return { createPanel, recreatePanel, dispose };
  }

  return { createPanelShell };
});


// SOURCE: src/ui/credit-view.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MwiGuildCreditCreditView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createCreditView(dependencies) {
    const {
      state,
      window,
      t,
      escapeHtml,
      formatNumber,
      iconMarkup,
      marketItemIconMarkup,
      itemNameForMaterial,
      creditQuantity,
      itemQuantity,
      core,
      GUILD_TOKEN_CREDIT_CONVERSIONS,
      loadSnapshot,
      creditConversionGroups,
      snapshotOrderBook,
      refreshOfficialItemNameCatalog
    } = dependencies;

    function renderCreditSection(creditItemHrid, color, ranked, priceLimited) {
      const available = ranked.filter((row) => row.status === "ok").slice(0, 5);
      const creditName = itemNameForMaterial(creditItemHrid);
      const icon = iconMarkup(creditItemHrid, creditName);
      const collapsed = state.collapsedCreditSections.has(creditItemHrid);
      const heading = `<button class="mwi-credit-heading" data-role="toggle-credit-section" type="button" aria-expanded="${String(!collapsed)}">${icon}<span>${escapeHtml(creditName)}</span><span class="mwi-collapse-icon" aria-hidden="true">${collapsed ? "▸" : "▾"}</span></button>`;
      if (!available.length) {
        const emptyMessage =
          priceLimited && state.maxConversionItemUnitPrice
            ? t("noMarketEstimateWithinPriceLimit", {
                limit: formatNumber(state.maxConversionItemUnitPrice / 1_000_000, 2)
              })
            : t("noMarketEstimate");
        return `<section class="mwi-credit-section" data-credit-item-hrid="${escapeHtml(creditItemHrid)}" data-collapsed="${String(collapsed)}" style="--mwi-credit-color:${color}">${heading}<div class="mwi-credit-body"${collapsed ? " hidden" : ""}><div class="mwi-empty">${escapeHtml(emptyMessage)}</div></div></section>`;
      }
      const itemLabel = escapeHtml(t("item"));
      const exchangeLabel = escapeHtml(t("exchange"));
      const perCreditLabel = escapeHtml(t("perCredit"));
      const targetCostLabel = escapeHtml(t("targetCost"));
      return `<section class="mwi-credit-section" data-credit-item-hrid="${escapeHtml(creditItemHrid)}" data-collapsed="${String(collapsed)}" style="--mwi-credit-color:${color}">${heading}<div class="mwi-credit-body"${collapsed ? " hidden" : ""}><table><colgroup><col class="mwi-credit-item-column"><col class="mwi-credit-exchange-column"><col class="mwi-credit-unit-cost-column"><col class="mwi-credit-target-cost-column"></colgroup><thead><tr><th>${itemLabel}</th><th>${exchangeLabel}</th><th>${perCreditLabel}</th><th>${targetCostLabel}</th></tr></thead><tbody>${available.map((row) => `<tr><td data-label="${itemLabel}" title="${escapeHtml(row.itemName)}"><span class="mwi-item">${marketItemIconMarkup(row.itemHrid, row.itemName)}<span class="mwi-item-name">${escapeHtml(row.itemName)}</span></span></td><td data-label="${exchangeLabel}">${escapeHtml(t("exchangeRate", { items: itemQuantity(row.itemCount), credits: creditQuantity(row.creditCount) }))}</td><td class="mwi-cost" data-label="${perCreditLabel}">${formatNumber(row.costPerCredit, 2)}</td><td data-label="${targetCostLabel}">${core.formatCompactCost(row.cost)}</td></tr>`).join("")}</tbody></table></div></section>`;
    }

    function renderGuildTokenValues(values) {
      const valuesByCredit = new Map(values.map((value) => [value.creditItemHrid, value]));
      const rows = GUILD_TOKEN_CREDIT_CONVERSIONS.map((rule) => {
        const value = valuesByCredit.get(rule.creditItemHrid) || { status: "unpriced", ...rule };
        const creditName = itemNameForMaterial(value.creditItemHrid);
        const exchange = t("exchangeRate", {
          items: `${formatNumber(value.guildTokenCount)} ${t("guildTokens")}`,
          credits: creditQuantity(value.creditCount)
        });
        if (value.status !== "ok") {
          return `<div class="mwi-token-value-row"><span class="mwi-item">${iconMarkup(value.creditItemHrid, creditName)}<span class="mwi-item-name">${escapeHtml(creditName)}</span></span><span class="mwi-token-value-exchange">${escapeHtml(exchange)}</span><span class="mwi-token-value-unpriced">${escapeHtml(t("noMarketValue"))}</span></div>`;
        }
        return `<div class="mwi-token-value-row"><span class="mwi-item">${iconMarkup(value.creditItemHrid, creditName)}<span class="mwi-item-name">${escapeHtml(creditName)}</span></span><span class="mwi-token-value-exchange">${escapeHtml(exchange)}</span><span class="mwi-cost">${core.formatCompactCost(value.goldValuePerToken)} ${escapeHtml(t("gold"))}</span></div>`;
      }).join("");
      const collapsed = state.guildTokenValuesCollapsed;
      const guildTokenName = itemNameForMaterial("/items/guild_token");
      const heading = `<button class="mwi-credit-heading mwi-token-value-heading" data-role="toggle-token-values" type="button" aria-expanded="${String(!collapsed)}">${iconMarkup("/items/guild_token", guildTokenName)}<span>${escapeHtml(t("tokenExchangeValue", { token: guildTokenName }))}</span><span class="mwi-collapse-icon" aria-hidden="true">${collapsed ? "▸" : "▾"}</span></button>`;
      return `<section class="mwi-token-value-section" data-collapsed="${String(collapsed)}">${heading}<div class="mwi-token-value-body mwi-token-value-list"${collapsed ? " hidden" : ""}>${rows}</div></section>`;
    }

    async function refreshPanel(panel, forceSnapshot) {
      refreshOfficialItemNameCatalog();
      if (state.refreshInFlight) {
        state.refreshQueued = true;
        return;
      }
      state.refreshInFlight = true;
      const status = panel.querySelector('[data-role="status"]');
      const results = panel.querySelector('[data-role="results"]');
      const button = panel.querySelector('[data-role="refresh"]');
      const target = Number(panel.querySelector('[data-role="target"]').value);
      button.disabled = true;
      status.hidden = false;
      results.replaceChildren();

      const unfilteredCreditGroups = creditConversionGroups({ applyPriceLimit: false });
      const conversionCount = unfilteredCreditGroups.reduce((total, group) => total + group.conversions.length, 0);
      if (!conversionCount) {
        status.textContent = t("noExchangeRules");
        button.disabled = false;
        finishRefresh(panel);
        return;
      }
      status.textContent = t("readingRules", { count: formatNumber(conversionCount) });

      try {
        await loadSnapshot(Boolean(forceSnapshot));
        const creditGroups = creditConversionGroups();
        const unfilteredConversionCounts = new Map(
          unfilteredCreditGroups.map((group) => [group.creditItemHrid, group.conversions.length])
        );
        const rankedGroups = creditGroups.map((group) => {
          const books = Object.fromEntries(
            group.conversions.map((conversion) => [conversion.itemHrid, snapshotOrderBook(conversion.itemHrid)])
          );
          const tokenRule = GUILD_TOKEN_CREDIT_CONVERSIONS.find((rule) => rule.creditItemHrid === group.creditItemHrid);
          return {
            ...group,
            priceLimited: group.conversions.length < (unfilteredConversionCounts.get(group.creditItemHrid) || 0),
            ranked: core.rankConversions(group.conversions, books, target),
            tokenRanked: core.rankConversions(group.conversions, books, tokenRule.creditCount)
          };
        });
        const tokenValues = core.rankGuildTokenCreditValues(
          GUILD_TOKEN_CREDIT_CONVERSIONS,
          Object.fromEntries(rankedGroups.map((group) => [group.creditItemHrid, group.tokenRanked]))
        );
        status.textContent = "";
        status.hidden = true;
        results.innerHTML = `${renderGuildTokenValues(tokenValues)}<div class="mwi-credit-grid">${rankedGroups.map((group) => renderCreditSection(group.creditItemHrid, group.color, group.ranked, group.priceLimited)).join("")}</div>`;
        if (state.marketSnapshotFallbackActive) {
          const ageMinutes = Math.max(1, Math.floor((Date.now() - Number(state.snapshotFetchedAt || 0)) / 60_000));
          status.textContent = t("snapshotFallbackUsed", { minutes: formatNumber(ageMinutes) });
          status.hidden = false;
        }
        button.disabled = false;
        finishRefresh(panel);
      } catch (error) {
        status.textContent = t("snapshotLoadFailed", { message: error.message });
        button.disabled = false;
        finishRefresh(panel);
      }
    }

    function finishRefresh(panel) {
      state.refreshInFlight = false;
      if (!state.refreshQueued) return;
      state.refreshQueued = false;
      window.clearTimeout(state.refreshTimer);
      state.refreshTimer = window.setTimeout(() => refreshPanel(panel), 250);
    }

    return { refreshPanel };
  }

  return { createCreditView };
});


// SOURCE: src/userscript.js
(function () {
  "use strict";
  const core = window.MwiGuildCreditCore;
  const marketDataApi = window.MwiGuildCreditMarketData;
  const itemNameCatalogApi = window.MwiGuildCreditItemNameCatalog;
  const releaseInfoApi = window.MwiGuildCreditReleaseInfo;
  const localizationApi = window.MwiGuildCreditLocalization;
  const buildingDataApi = window.MwiGuildBuildingData;
  const shrineGuideApi = window.MwiGuildCreditShrineGuide;
  const configApi = window.MwiGuildCreditConfig;
  const storageApi = window.MwiGuildCreditStorage;
  const schedulerApi = window.MwiGuildCreditScheduler;
  const gameStateApi = window.MwiGuildCreditGameState;
  const gameDataApi = window.MwiGuildCreditGameData;
  const domApi = window.MwiGuildCreditDom;
  const sidebarIntegrationApi = window.MwiGuildCreditSidebarIntegration;
  const sortableApi = window.MwiGuildCreditSortable;
  const stylesApi = window.MwiGuildCreditStyles;
  const constructionViewApi = window.MwiGuildCreditConstructionView;
  const upgradeViewApi = window.MwiGuildCreditUpgradeView;
  const settingsViewApi = window.MwiGuildCreditSettingsView;
  const shrineGuideUiApi = window.MwiGuildCreditShrineGuideUi;
  const exchangeAdvisorApi = window.MwiGuildCreditExchangeAdvisor;
  const panelShellApi = window.MwiGuildCreditPanelShell;
  const trialHistoryApi = window.MwiGuildTrialHistory;
  const trialHistoryViewApi = window.MwiGuildTrialHistoryView;
  const creditViewApi = window.MwiGuildCreditCreditView;
  if (
    !core ||
    !marketDataApi ||
    !itemNameCatalogApi ||
    !releaseInfoApi ||
    !localizationApi ||
    !buildingDataApi ||
    !shrineGuideApi ||
    !configApi ||
    !storageApi ||
    !schedulerApi ||
    !gameStateApi ||
    !gameDataApi ||
    !domApi ||
    !sidebarIntegrationApi ||
    !sortableApi ||
    !stylesApi ||
    !constructionViewApi ||
    !upgradeViewApi ||
    !settingsViewApi ||
    !shrineGuideUiApi ||
    !exchangeAdvisorApi ||
    !panelShellApi ||
    !creditViewApi ||
    !trialHistoryApi ||
    !trialHistoryViewApi
  )
    return;
  const pageWindow = typeof unsafeWindow === "undefined" ? window : unsafeWindow;
  const PLUGIN_VERSION = String(window.MwiGuildCreditVersion || "0.0.0");
  const {
    UPDATE_SOURCES,
    FALLBACK_INSTALL_URL,
    UPDATE_CHECK_TIMEOUT_MS,
    SHOW_ALL_CREDIT_TOKEN_TOGGLE,
    PRICE_REFERENCES,
    GUILD_TOKEN_BUDGET_SNAP_PERCENTAGES,
    GUILD_TOKEN_BUDGET_SNAP_THRESHOLD_PERCENTAGE,
    RENDERED_MARKUP_PROPERTY,
    PANEL_VIEWS,
    DEFAULT_PANEL_ORDER,
    CREDIT_TYPES,
    GUILD_TOKEN_CREDIT_CONVERSIONS,
    SELLER_TAX_RATE,
    GUILD_SHRINE_NAME_KEYS
  } = configApi;
  const pluginStorage = storageApi.createPluginStorage({
    storage: pageWindow.localStorage,
    location: pageWindow.location,
    config: configApi,
    buildingDataApi,
    marketDataApi,
    trialHistoryApi
  });
  const savedUiState = pluginStorage.loadSavedPluginUiState();
  const savedBuildingPlannerState = pluginStorage.loadSavedGuildBuildingPlannerState();
  const savedMarketState = pluginStorage.loadSavedLiveMarketData();
  const savedMarketSnapshot = pluginStorage.loadSavedMarketSnapshot();
  const savedMarketplaceRequestState = pluginStorage.loadMarketplaceRequestState();
  const itemNameCatalog = itemNameCatalogApi.createItemNameCatalog({
    pageWindow,
    document,
    storage: pageWindow.localStorage,
    version: PLUGIN_VERSION
  });
  const updateChecker = releaseInfoApi.createVersionChecker({
    fetchImpl: pageWindow.fetch && pageWindow.fetch.bind(pageWindow),
    sources: UPDATE_SOURCES,
    timeoutMs: UPDATE_CHECK_TIMEOUT_MS,
    setTimeout: pageWindow.setTimeout && pageWindow.setTimeout.bind(pageWindow),
    clearTimeout: pageWindow.clearTimeout && pageWindow.clearTimeout.bind(pageWindow),
    AbortController: pageWindow.AbortController
  });
  const state = {
    itemDetails: null,
    conversionCache: new Map(),
    guildBuffDetails: null,
    guildBuffLevels: null,
    ...storageApi.guildPointStateFromSnapshot(savedBuildingPlannerState.guildPointSnapshot),
    guildPointSummaryBridgeRevision: 0,
    ...savedBuildingPlannerState.guildPointSettings,
    guildShrineLevels: null,
    guildShrineDetails: null,
    characterItems: null,
    characterItemsBridgeRevision: 0,
    guildBuffLevelsBridgeRevision: 0,
    detectedGameLocale: null,
    panelLocale: null,
    upgradePlans: savedUiState.upgradePlans.map((plan, index) => ({ id: `plan-${index + 1}`, ...plan })),
    nextUpgradePlanId: savedUiState.upgradePlans.length + 1,
    upgradePresetNotice: "",
    guildTokenCreditHrids: new Set(savedUiState.guildTokenCreditHrids),
    autoGuildTokenBudget: savedUiState.autoGuildTokenBudget,
    shrineGuideEnabled: savedUiState.shrineGuideEnabled,
    maxConversionItemUnitPrice: savedUiState.maxConversionItemUnitPrice,
    guildShrineAutofillExcludedBuffHrids: new Set(savedUiState.guildShrineAutofillExcludedBuffHrids),
    showConstructionView: savedUiState.showConstructionView,
    showTrialHistoryView: savedUiState.showTrialHistoryView,
    sidebarDisplayName: savedUiState.sidebarDisplayName,
    settingsOpen: false,
    shrineGuideContext: null,
    shrineGuideModel: null,
    shrineGuideFrame: null,
    shrineGuideObserver: null,
    shrineGuideObservedNodes: new Set(),
    shrineGuideDocumentListenersInstalled: false,
    shrineGuideDocumentHandlers: null,
    snapshot: savedMarketSnapshot.snapshot,
    snapshotTimestamp: marketDataApi.normalizeMarketTimestamp(savedMarketSnapshot.snapshot?.timestamp),
    snapshotFetchedAt: savedMarketSnapshot.fetchedAt,
    marketSnapshotForbiddenUntilByOrigin: savedMarketplaceRequestState.forbiddenUntilByOrigin,
    marketSnapshotFallbackActive: false,
    marketSnapshotCandidateSignature: "",
    marketSnapshotCandidateTimestamp: 0,
    marketSnapshotCandidateConfirmations: 0,
    marketLiveData: savedMarketState.liveData,
    marketLiveRevision: savedMarketState.revision,
    marketBridgeRevision: 0,
    marketUpdateSignatures: Object.create(null),
    priceReference: pluginStorage.loadPriceReference(),
    targetCredit: savedUiState.targetCredit,
    activeView: savedUiState.activeView,
    panelOrder: savedUiState.panelOrder,
    panel: null,
    creditTab: null,
    refreshTimer: null,
    refreshInFlight: false,
    refreshQueued: false,
    collapsedCreditSections: new Set(savedUiState.collapsedCreditSections),
    guildTokenValuesCollapsed: savedUiState.guildTokenValuesCollapsed,
    upgradeRefreshId: 0,
    exchangeAdvisorUi: null,
    exchangeAdvisorRootObserver: null,
    exchangeAdvisorModalObserver: null,
    exchangeAdvisorObservedModal: null,
    exchangeAdvisorListenersInstalled: false,
    exchangeAdvisorRepositionHandler: null,
    exchangeAdvisorLoadInFlight: false,
    exchangeAdvisorSnapshotFailed: false
  };
  state.guildBuildingLevels = null;
  state.guildBuildingLevelsComplete = false;
  state.guildBuildingDetails = null;
  state.buildingPlans = savedBuildingPlannerState.plans.map((plan, index) => ({
    id: `building-plan-${index + 1}`,
    ...plan
  }));
  state.nextBuildingPlanId = state.buildingPlans.length + 1;
  state.manualGuildPoints = savedBuildingPlannerState.manualGuildPoints;
  state.guildPointHistory = savedBuildingPlannerState.guildPointHistory;
  state.buildingCategory = savedBuildingPlannerState.category;
  state.buildingSearch = "";
  state.buildingPlanNotice = "";
  let guildBuildingSpriteHref = "";
  let guildBuildingSpriteLoadPromise = null;
  const gameState = gameStateApi.createGameStateAdapter(state);
  const { guildShrineLevelRecordKey } = gameStateApi;
  const {
    setItemDetails,
    setGuildBuffDetails,
    setCharacterItems,
    setGuildBuffLevelsFrom,
    setGuildShrineLevelsFrom,
    setGuildShrineDetailsFrom,
    setGuildBuildingLevelsFrom,
    seedCompleteGuildBuildingLevelsFrom,
    setGuildBuildingDetailsFrom,
    setGuildPointSummaryFrom,
    setGuildWeekStartAtFrom
  } = gameState;
  const updateRenderedMarkup = (element, markup) =>
    domApi.updateRenderedMarkup(element, markup, RENDERED_MARKUP_PROPERTY);
  const escapeHtml = domApi.escapeHtml;
  const itemHridFromIcon = domApi.itemHridFromIcon;
  const enhancementLevelFromIcon = domApi.enhancementLevelFromIcon;
  const guildTokenBudgetRefreshTask = schedulerApi.createDebouncedTask({
    task: (panel) => refreshGuildUpgrade(panel),
    delay: 80,
    setTimer: window.setTimeout.bind(window),
    clearTimer: window.clearTimeout.bind(window)
  });
  const marketDataRefreshTask = schedulerApi.createDebouncedTask({
    task: () => {
      if (state.panel && state.panel.isConnected && !state.panel.hidden) {
        if (state.panel.dataset.activeView === "upgrade") refreshGuildUpgrade(state.panel);
        else refreshPanel(state.panel);
      }
      scheduleGuildExchangeAdvisor(true);
    },
    delay: 120,
    setTimer: window.setTimeout.bind(window),
    clearTimer: window.clearTimeout.bind(window)
  });
  const inventoryDataRefreshTask = schedulerApi.createDebouncedTask({
    task: () => {
      if (
        state.panel &&
        state.panel.isConnected &&
        !state.panel.hidden &&
        state.panel.dataset.activeView === "upgrade"
      ) {
        refreshGuildUpgrade(state.panel);
      }
      scheduleGuildExchangeAdvisor(true);
      scheduleShrineGuide();
    },
    delay: 120,
    setTimer: window.setTimeout.bind(window),
    clearTimer: window.clearTimeout.bind(window)
  });
  const guildDataRefreshTask = schedulerApi.createDebouncedTask({
    task: () => {
      constructionView.syncGuildPointHistory();
      persistGuildBuildingPlannerState();
      if (state.panel && state.panel.isConnected && state.panel.dataset.activeView === "upgrade")
        refreshGuildUpgrade(state.panel);
      else if (state.panel && state.panel.isConnected && state.panel.dataset.activeView === "construction")
        refreshGuildConstruction(state.panel);
      else scheduleShrineGuide();
      if (state.panel && state.panel.isConnected && state.settingsOpen) refreshSettings(state.panel);
    },
    delay: 120,
    setTimer: window.setTimeout.bind(window),
    clearTimer: window.clearTimeout.bind(window)
  });
  const requestAdvisorFrame =
    typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame.bind(window)
      : (handler) => window.setTimeout(handler, 0);
  const cancelAdvisorFrame =
    typeof window.cancelAnimationFrame === "function"
      ? window.cancelAnimationFrame.bind(window)
      : window.clearTimeout.bind(window);
  const exchangeAdvisorFrameTask = schedulerApi.createFrameTask({
    task: (forceRender) => refreshGuildExchangeAdvisor(Boolean(forceRender)),
    requestFrame: requestAdvisorFrame,
    cancelFrame: cancelAdvisorFrame,
    merge: (current, next) => Boolean(current || next)
  });

  function normalizePanelView(view) {
    return storageApi.normalizePanelView(view, PANEL_VIEWS);
  }
  function persistGuildBuildingPlannerState() {
    pluginStorage.persistGuildBuildingPlannerState(state);
  }
  function persistPluginUiState() {
    return pluginStorage.persistPluginUiState(state);
  }
  function persistLiveMarketData() {
    pluginStorage.persistLiveMarketData(state.marketLiveData, state.marketLiveRevision);
  }
  function setPriceReference(reference) {
    if (!PRICE_REFERENCES[reference]) return;
    state.priceReference = reference;
    pluginStorage.persistPriceReference(reference);
  }
  function ui() {
    return localizationApi.createLocalizer(currentGameLocale());
  }
  function t(key, values) {
    return ui().t(key, values);
  }
  function itemQuantity(value) {
    return ui().quantity("itemQuantity", value);
  }
  function creditQuantity(value) {
    return ui().quantity("creditQuantity", value);
  }
  function priceReference(reference) {
    const suffix = reference === "b" ? "B" : "A";
    return { label: t(`priceReference${suffix}`), title: t(`priceReference${suffix}Title`) };
  }

  function simpleItemName(itemHrid) {
    return String(itemHrid || t("unknownItem"))
      .split("/")
      .pop()
      .replaceAll("_", " ");
  }

  function titleCase(value) {
    return String(value || "").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function currentGameLocale() {
    const candidates = [state.detectedGameLocale];
    try {
      candidates.push(
        pageWindow.i18next && pageWindow.i18next.resolvedLanguage,
        pageWindow.i18next && pageWindow.i18next.language,
        pageWindow.i18n && pageWindow.i18n.resolvedLanguage,
        pageWindow.i18n && pageWindow.i18n.language,
        pageWindow.localStorage && pageWindow.localStorage.getItem("i18nextLng")
      );
    } catch (_) {}
    candidates.push(document.documentElement.lang);
    return localizationApi.resolveLocaleCandidates(candidates, "zh-CN");
  }

  function refreshOfficialItemNameCatalog(force, requiredItemHrids) {
    return itemNameCatalog.refreshIfDue({
      force: force === true,
      requiredItemHrids: Array.isArray(requiredItemHrids) ? requiredItemHrids : []
    }).changed;
  }

  // This is the sole item-name resolver used by the UI. Official game names
  // remain authoritative; stable guild currencies have a bundled localized
  // fallback for environments where the game's i18n catalog is unavailable.
  function resolveItemName(itemHrid, englishFallback) {
    const localizer = ui();
    if (localizer.locale === "zh-CN") refreshOfficialItemNameCatalog(false, [itemHrid]);
    return itemNameCatalog.resolveItemName({
      itemHrid,
      englishFallback: localizer.itemName(itemHrid) || englishFallback,
      locale: localizer.locale
    });
  }

  // The game persists initClientData with LZString.compressToUTF16. Reading it
  // avoids depending on the timing of the one-time WebSocket initialization.
  const gameData = gameDataApi.createGameData({
    state,
    pageWindow,
    document,
    marketDataApi,
    core,
    setItemDetails,
    setGuildBuffDetails,
    setCharacterItems,
    setGuildBuffLevelsFrom,
    setGuildShrineLevelsFrom,
    setGuildShrineDetailsFrom,
    setGuildBuildingLevelsFrom,
    seedCompleteGuildBuildingLevelsFrom,
    setGuildBuildingDetailsFrom,
    setGuildPointSummaryFrom,
    setGuildWeekStartAtFrom,
    persistLiveMarketData,
    pluginStorage,
    config: configApi,
    scheduleMarketDataRefresh,
    scheduleInventoryDataRefresh,
    scheduleGuildDataRefresh,
    resolveItemName,
    CREDIT_TYPES,
    fetchImpl: pageWindow.fetch && pageWindow.fetch.bind(pageWindow)
  });
  const {
    hydrateLocalInitData,
    extractItemDetailsFromReact,
    hydrateBridgeData,
    loadSnapshot,
    snapshotOrderBook,
    snapshotPrice,
    snapshotImmediateSellPrice,
    allConversions,
    creditConversionGroups
  } = gameData;

  function itemSpriteHref(itemHrid) {
    const spriteUse = document.querySelector('use[href*="items_sprite"]');
    const href = spriteUse && spriteUse.getAttribute("href");
    if (!href || !href.includes("#")) return "";
    return `${href.slice(0, href.indexOf("#"))}#${String(itemHrid || "")
      .split("/")
      .pop()}`;
  }

  function iconMarkup(itemHrid, label) {
    const href = itemSpriteHref(itemHrid);
    if (!href) return '<span class="mwi-item-icon mwi-item-icon-fallback" aria-hidden="true"></span>';
    return `<svg class="mwi-item-icon" role="img" aria-label="${escapeHtml(label)}"><use href="${escapeHtml(href)}"></use></svg>`;
  }

  function guildBuildingSpriteBaseHref() {
    if (guildBuildingSpriteHref) return guildBuildingSpriteHref;
    const discovered = domApi.findSpriteBaseHref(document, "misc_sprite");
    if (discovered) {
      guildBuildingSpriteHref = discovered;
      return guildBuildingSpriteHref;
    }
    void loadGuildBuildingSpriteBaseHref();
    return "";
  }

  function loadGuildBuildingSpriteBaseHref() {
    if (guildBuildingSpriteHref) return Promise.resolve(guildBuildingSpriteHref);
    if (guildBuildingSpriteLoadPromise) return guildBuildingSpriteLoadPromise;
    const fetchImpl = pageWindow.fetch && pageWindow.fetch.bind(pageWindow);
    if (!fetchImpl || !pageWindow.location || !pageWindow.location.origin) return Promise.resolve("");
    const manifestUrl = new URL("/asset-manifest.json", pageWindow.location.origin).href;
    guildBuildingSpriteLoadPromise = fetchImpl(manifestUrl, { cache: "force-cache" })
      .then((response) => {
        if (!response || !response.ok) throw new Error("asset manifest unavailable");
        return response.json();
      })
      .then((manifest) => {
        const reference = domApi.spriteBaseFromAssetManifest(manifest, "misc_sprite");
        if (!reference) throw new Error("misc sprite unavailable");
        guildBuildingSpriteHref = new URL(reference, pageWindow.location.origin).href;
        if (
          state.panel &&
          state.panel.isConnected &&
          !state.panel.hidden &&
          state.panel.dataset.activeView === "construction"
        )
          refreshGuildConstruction(state.panel);
        if (state.panel?.isConnected && state.settingsOpen) refreshSettings(state.panel);
        if (state.panel?.isConnected && state.panel.dataset.activeView === "upgrade") refreshGuildUpgrade(state.panel);
        return guildBuildingSpriteHref;
      })
      .catch(() => "");
    return guildBuildingSpriteLoadPromise;
  }

  function guildBuildingIconMarkup(definition, spriteBaseHref) {
    const symbolId = definition && (definition.iconSymbolId || buildingDataApi.iconSymbolId(definition.hrid));
    if (!spriteBaseHref || !symbolId)
      return '<span class="mwi-building-icon mwi-building-icon-fallback" aria-hidden="true"><svg viewBox="0 0 50 50" focusable="false"><path d="M7 43V20l18-12 18 12v23H7Z"></path><path d="M17 43V28h16v15M4 43h42"></path></svg></span>';
    const href = `${spriteBaseHref}#${symbolId}`;
    return `<span class="mwi-building-icon" data-icon-source="game"><svg aria-hidden="true" focusable="false" viewBox="0 0 50 50" width="100%" height="100%"><use href="${escapeHtml(href)}" width="50" height="50"></use></svg></span>`;
  }

  function marketItemIconMarkup(itemHrid, label, className = "") {
    const marketLabel = t("marketItem", { item: label });
    return `<button class="mwi-market-item-link ${escapeHtml(className)}" data-role="market-item-link" data-item-hrid="${escapeHtml(itemHrid)}" data-item-name="${escapeHtml(label)}" type="button" title="${escapeHtml(marketLabel)}" aria-label="${escapeHtml(marketLabel)}">${iconMarkup(itemHrid, label)}</button>`;
  }

  function marketplaceSearchInput() {
    return (
      Array.from(document.querySelectorAll("input")).find((input) => {
        if (input.closest("#mwi-credit-optimizer")) return false;
        const text =
          `${input.getAttribute("placeholder") || ""} ${input.getAttribute("aria-label") || ""}`.toLowerCase();
        return text.includes("物品搜尋") || text.includes("search") || text.includes("item");
      }) || null
    );
  }

  function openMarketplaceFallback(itemHrid, itemName) {
    const searchText = resolveItemName(itemHrid, itemName);
    const navigate = Array.from(document.querySelectorAll("button,[role='button'],a,div")).find((element) => {
      if (element.closest("#mwi-credit-optimizer")) return false;
      return ["市場", "Marketplace", "Market"].includes(String(element.textContent || "").trim());
    });
    if (navigate) navigate.click();
    let attempts = 0;
    const search = () => {
      const input = marketplaceSearchInput();
      if (!input && attempts++ < 20) {
        window.setTimeout(search, 80);
        return;
      }
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      if (setter && setter.set) setter.set.call(input, searchText);
      else input.value = searchText;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.focus();
    };
    window.setTimeout(search, navigate ? 80 : 0);
  }

  function openMarketplaceForItem(itemHrid, itemName) {
    const bridge = window.__mwiGuildCreditBridge;
    try {
      // Our recommendation rows are unenhanced materials. Mirror the native
      // inventory action by explicitly using level 0 instead of leaving the
      // market order-book selection undefined.
      if (bridge && typeof bridge.goToMarketplace === "function" && bridge.goToMarketplace(itemHrid, 0)) return;
    } catch (_) {
      // Fall through to the compatibility path if the game changes its React internals.
    }
    openMarketplaceFallback(itemHrid, itemName);
  }

  function formatNumber(value, digits) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "-";
    return ui().number(value, digits);
  }

  async function checkPluginUpdate(panel) {
    const status = panel.querySelector('[data-role="version-status"]');
    if (!status) return;
    status.textContent = t("updateChecking", { current: PLUGIN_VERSION });
    try {
      const { latestVersion, installUrl } = await updateChecker.latestRelease();
      if (core.compareVersions(PLUGIN_VERSION, latestVersion) < 0) {
        status.classList.add("mwi-update-available");
        status.replaceChildren(t("updateAvailable", { current: PLUGIN_VERSION, latest: latestVersion }));
        const updateLink = document.createElement("a");
        updateLink.className = "mwi-update-link";
        updateLink.href = installUrl;
        updateLink.target = "_blank";
        updateLink.rel = "noopener noreferrer";
        updateLink.textContent = t("updateNow");
        status.append(" · ", updateLink);
      } else {
        status.classList.remove("mwi-update-available");
        status.textContent = t("updateLatest", { current: PLUGIN_VERSION, latest: latestVersion });
      }
    } catch (_) {
      status.classList.remove("mwi-update-available");
      status.textContent = t("updateUnavailable", { current: PLUGIN_VERSION });
    }
  }

  const upgradeView = upgradeViewApi.createUpgradeView({
    core,
    state,
    t,
    ui,
    escapeHtml,
    resolveItemName,
    simpleItemName,
    titleCase,
    formatNumber,
    iconMarkup,
    marketItemIconMarkup,
    guildBuildingSpriteBaseHref,
    guildBuildingIconMarkup,
    itemQuantity,
    creditQuantity,
    snapshotOrderBook,
    allConversions,
    CREDIT_TYPES,
    GUILD_TOKEN_CREDIT_CONVERSIONS,
    GUILD_TOKEN_BUDGET_SNAP_PERCENTAGES,
    GUILD_TOKEN_BUDGET_SNAP_THRESHOLD_PERCENTAGE,
    GUILD_SHRINE_NAME_KEYS,
    SHOW_ALL_CREDIT_TOKEN_TOGGLE,
    guildShrineLevelRecordKey,
    persistPluginUiState,
    updateRenderedMarkup,
    hydrateBridgeData,
    extractItemDetailsFromReact,
    hydrateLocalInitData,
    loadSnapshot,
    refreshOfficialItemNameCatalog,
    scheduleShrineGuide: (...args) => scheduleShrineGuide(...args),
    scheduleGuildExchangeAdvisor: (...args) => scheduleGuildExchangeAdvisor(...args),
    guildTokenBudgetRefreshTask
  });
  const {
    guildBuffEntries,
    guildBuffLabel,
    itemNameForMaterial,
    currentGuildBuffLevel,
    shrineLevelValue,
    shrineIdentityValues,
    applyGuildShrineTargets,
    addGuildUpgradePlan,
    clearGuildUpgradePlans,
    removeGuildUpgradePlan,
    guildTokenCreditSelectionState,
    updateGuildTokenCreditPlanButton,
    renderGuildTokenCreditPlanToggle,
    renderGuildTokenBudgetControl,
    setGuildTokenBudget,
    refreshGuildUpgrade
  } = upgradeView;

  const settingsView = settingsViewApi.createSettingsView({
    core,
    guildBuildingSpriteBaseHref,
    guildBuildingIconMarkup,
    state,
    t,
    ui,
    escapeHtml,
    guildBuffEntries,
    guildBuffLabel,
    updateRenderedMarkup
  });
  const { renderSettingsMarkup, refreshSettings } = settingsView;
  const constructionView = constructionViewApi.createConstructionView({
    state,
    buildingDataApi,
    t,
    ui,
    core,
    escapeHtml,
    formatNumber,
    titleCase,
    simpleItemName,
    shrineIdentityValues,
    shrineLevelValue,
    guildBuildingSpriteBaseHref,
    guildBuildingIconMarkup,
    updateRenderedMarkup,
    persistGuildBuildingPlannerState,
    hydrateBridgeData,
    extractItemDetailsFromReact,
    hydrateLocalInitData,
    pageWindow,
    document,
    URL,
    Blob,
    guildTrialFirstStartAt: configApi.GUILD_TRIAL_FIRST_START_AT
  });
  const {
    guildBuildingDefinitions,
    addGuildBuildingPlan,
    setGuildBuildingTarget,
    removeGuildBuildingPlan,
    moveGuildBuildingPlan,
    reorderGuildBuildingPlan,
    setGuildBuildingPickerOpen,
    toggleGuildBuildingSteps,
    clearGuildBuildingPlans,
    undoClearGuildBuildingPlans,
    hasGuildBuildingClearUndo,
    applyGuildBuildingFilters,
    refreshGuildConstructionBudgetPreview,
    refreshGuildConstruction,
    copyGuildConstructionPlan,
    exportGuildConstructionCsv,
    exportGuildPointHistoryCsv,
    resetGuildPointHistory,
    dispose: disposeConstructionView
  } = constructionView;

  const shrineGuideUi = shrineGuideUiApi.createShrineGuideUi({
    state,
    document,
    window,
    stylesApi,
    t,
    ui,
    formatNumber,
    itemNameForMaterial,
    CREDIT_TYPES,
    shrineGuideApi,
    refreshGuildUpgrade,
    persistPluginUiState,
    scheduleGuildExchangeAdvisor: (...args) => scheduleGuildExchangeAdvisor(...args),
    guildExchangeMutationObserver: (...args) => guildExchangeMutationObserver(...args),
    findGuildExchangeModal: (...args) => findGuildExchangeModal(...args)
  });
  const { scheduleShrineGuide, startShrineGuideObserver, stopShrineGuideObserver, setShrineGuideEnabled } =
    shrineGuideUi;

  const trialHistoryView = trialHistoryViewApi.createTrialHistoryView({
    document,
    domApi,
    pageWindow,
    t,
    escapeHtml,
    pluginStorage,
    trialHistoryApi,
    playerViewApi: window.MwiGuildTrialPlayerView,
    sortableApi,
    screenshotApi: window.MwiGuildTrialScreenshot,
    profileReaderApi: window.MwiGuildProfileReader,
    profileTooltipApi: window.MwiGuildProfileTooltip,
    resolveItemName,
    getBridge: () => window.__mwiGuildCreditBridge,
    getPanel: () => state.panel
  });
  const refreshTrialHistory = (panel) => trialHistoryView.refresh(panel);

  const panelShell = panelShellApi.createPanelShell({
    state,
    document,
    stylesApi,
    sortableApi,
    t,
    escapeHtml,
    PANEL_VIEWS,
    DEFAULT_PANEL_ORDER,
    CREDIT_TYPES,
    FALLBACK_INSTALL_URL,
    priceReference,
    normalizePanelView,
    persistPluginUiState,
    normalizeSidebarDisplayName: storageApi.normalizeSidebarDisplayName,
    checkPluginUpdate,
    refreshPanel: (...args) => refreshPanel(...args),
    refreshGuildUpgrade,
    refreshGuildConstruction,
    refreshTrialHistory,
    bindTrialHistory: (panel) => trialHistoryView.bind(panel),
    refreshGuildExchangeAdvisor: (...args) => refreshGuildExchangeAdvisor(...args),
    renderSettingsMarkup,
    refreshSettings,
    renderGuildTokenCreditPlanToggle,
    renderGuildTokenBudgetControl,
    updateGuildTokenCreditPlanButton,
    setGuildTokenBudget,
    setShrineGuideEnabled,
    guildBuffEntries,
    currentGuildBuffLevel,
    applyGuildShrineTargets,
    addGuildUpgradePlan,
    clearGuildUpgradePlans,
    removeGuildUpgradePlan,
    guildTokenCreditSelectionState,
    guildBuildingDefinitions,
    addGuildBuildingPlan,
    setGuildBuildingTarget,
    removeGuildBuildingPlan,
    moveGuildBuildingPlan,
    reorderGuildBuildingPlan,
    setGuildBuildingPickerOpen,
    toggleGuildBuildingSteps,
    clearGuildBuildingPlans,
    undoClearGuildBuildingPlans,
    hasGuildBuildingClearUndo,
    applyGuildBuildingFilters,
    refreshGuildConstructionBudgetPreview,
    copyGuildConstructionPlan,
    exportGuildConstructionCsv,
    exportGuildPointHistoryCsv,
    constructionView,
    resetGuildPointHistory,
    persistGuildBuildingPlannerState,
    setPriceReference,
    openMarketplaceForItem
  });
  const { createPanel, recreatePanel, dispose: disposePanelShell } = panelShell;

  const creditView = creditViewApi.createCreditView({
    state,
    window,
    t,
    escapeHtml,
    formatNumber,
    iconMarkup,
    marketItemIconMarkup,
    itemNameForMaterial,
    creditQuantity,
    itemQuantity,
    core,
    GUILD_TOKEN_CREDIT_CONVERSIONS,
    loadSnapshot,
    creditConversionGroups,
    snapshotOrderBook,
    refreshOfficialItemNameCatalog
  });
  const { refreshPanel } = creditView;

  function scheduleMarketDataRefresh() {
    marketDataRefreshTask.schedule();
  }

  function scheduleInventoryDataRefresh() {
    inventoryDataRefreshTask.schedule();
  }
  function scheduleGuildDataRefresh() {
    guildDataRefreshTask.schedule();
  }

  const exchangeAdvisor = exchangeAdvisorApi.createExchangeAdvisor({
    state,
    document,
    window,
    pageWindow,
    stylesApi,
    CREDIT_TYPES,
    SELLER_TAX_RATE,
    t,
    escapeHtml,
    formatNumber,
    itemNameForMaterial,
    itemHridFromIcon,
    enhancementLevelFromIcon,
    itemQuantity,
    creditQuantity,
    iconMarkup,
    priceReference,
    core,
    loadSnapshot,
    snapshotOrderBook,
    snapshotImmediateSellPrice,
    snapshotPrice,
    allConversions,
    exchangeAdvisorFrameTask
  });
  const {
    findGuildExchangeModal,
    refreshGuildExchangeAdvisor,
    scheduleGuildExchangeAdvisor,
    guildExchangeMutationObserver,
    startGuildExchangeAdvisor
  } = exchangeAdvisor;

  const sidebarController = sidebarIntegrationApi.createController({
    window,
    state,
    getLocale: currentGameLocale,
    getLabel: () => state.sidebarDisplayName || t("sidebarCredit"),
    onLocale: (locale) => {
      state.detectedGameLocale = locale;
    },
    createPanel,
    recreatePanel,
    beforeRefresh: refreshOfficialItemNameCatalog,
    onRefresh: refreshActivePanel,
    onActivate: (panel) => {
      hydrateBridgeData();
      extractItemDetailsFromReact();
      hydrateLocalInitData();
      refreshActivePanel(panel);
    },
    onMount: (panel) => {
      if (state.shrineGuideEnabled) {
        startShrineGuideObserver();
        refreshGuildUpgrade(panel);
      } else {
        scheduleShrineGuide();
      }
    }
  });

  function refreshActivePanel(panel) {
    if (state.settingsOpen) refreshSettings(panel);
    if (panel.dataset.activeView === "upgrade") refreshGuildUpgrade(panel);
    else if (panel.dataset.activeView === "construction") refreshGuildConstruction(panel);
    else if (panel.dataset.activeView === "trials") refreshTrialHistory(panel);
    else refreshPanel(panel);
  }

  function exchangeModalInteractionHandler(event) {
    const target = event.target && (event.target.nodeType === 1 ? event.target : event.target.parentElement);
    if (target && target.closest && target.closest('[class*="GuildPanel_exchangeModalContent"]'))
      scheduleGuildExchangeAdvisor();
  }

  function disposeRuntime() {
    trialHistoryView.dispose();
    disposePanelShell();
    disposeConstructionView();
    guildTokenBudgetRefreshTask.dispose();
    marketDataRefreshTask.dispose();
    inventoryDataRefreshTask.dispose();
    guildDataRefreshTask.dispose();
    sidebarController.destroy();
    exchangeAdvisorFrameTask.dispose();
    window.clearTimeout(state.refreshTimer);
    stopShrineGuideObserver();
    if (state.exchangeAdvisorRootObserver) state.exchangeAdvisorRootObserver.disconnect();
    if (state.exchangeAdvisorModalObserver) state.exchangeAdvisorModalObserver.disconnect();
    if (state.exchangeAdvisorRepositionHandler) {
      const reposition = state.exchangeAdvisorRepositionHandler;
      window.removeEventListener("resize", reposition);
      window.removeEventListener("orientationchange", reposition);
      window.removeEventListener("scroll", reposition, true);
    }
    document.removeEventListener("input", exchangeModalInteractionHandler, true);
    document.removeEventListener("click", exchangeModalInteractionHandler, true);
  }

  trialHistoryView.start();
  hydrateBridgeData();
  extractItemDetailsFromReact();
  hydrateLocalInitData();
  document.addEventListener("input", exchangeModalInteractionHandler, true);
  document.addEventListener("click", exchangeModalInteractionHandler, true);
  window.addEventListener("pagehide", disposeRuntime, { once: true });
  if (document.body) startGuildExchangeAdvisor();
  else document.addEventListener("DOMContentLoaded", startGuildExchangeAdvisor, { once: true });
  sidebarController.start();
})();
