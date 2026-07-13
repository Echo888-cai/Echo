import { hkRepository } from "./financialsRepository.js";
export const upsertHkFinancials = hkRepository.upsert;
export const getHkFinancials = hkRepository.list;
export const hasHkFinancialsForUrl = hkRepository.hasUrl;
export const upsertHkFilingIngestLog = hkRepository.upsertLog;
export const getHkFilingCoverage = hkRepository.coverage;
