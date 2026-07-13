import { cnRepository } from "./financialsRepository.js";
export const upsertCnFinancials = cnRepository.upsert;
export const getCnFinancials = cnRepository.list;
export const hasCnFinancialsForUrl = cnRepository.hasUrl;
export const upsertCnFilingIngestLog = cnRepository.upsertLog;
export const getCnFilingCoverage = cnRepository.coverage;
