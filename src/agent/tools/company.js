/**
 * CompanyTool - 获取公司档案和基本面信息
 *
 * 优先从本地 SQLite 数据库查询，找不到时尝试 FMP API。
 * 支持 650+ 港股公司覆盖。
 */
import { Tool } from "../tool.js";
import { companyByTicker } from "../../data.js";
import { getCompanyProfile, companyProfileToMarkdown } from "../../financialData.js";

let dbGetCompany = null;
async function lazyDb() {
  if (dbGetCompany === null) {
    try {
      const mod = await import("../../db/index.js");
      dbGetCompany = mod.getCompanyByTicker || (() => null);
    } catch {
      dbGetCompany = () => null;
    }
  }
  return dbGetCompany;
}

export class CompanyTool extends Tool {
  name() { return "get_company_profile"; }
  description() { return "获取港股公司的档案信息，包括名称、业务描述、摘要、风险点、监控指标等。支持 650+ 港股公司。"; }
  parameters() {
    return [
      { name: "ticker", type: "string", description: "港股代码，如 0700.HK", required: true }
    ];
  }

  async execute(args) {
    // Try seed data first (35 companies with rich profiles)
    let company = companyByTicker(args.ticker);

    // Fallback to SQLite database (650+ companies)
    if (!company) {
      try {
        const getter = await lazyDb();
        if (getter) {
          const dbRow = getter(args.ticker);
          if (dbRow) company = dbRow;
        }
      } catch {
        // DB unavailable in browser context
      }
    }

    // Get profile from FMP for additional data
    const fmpProfile = await getCompanyProfile(args.ticker).catch(() => null);

    return {
      ticker: args.ticker,
      nameZh: company?.nameZh || fmpProfile?.nameZh || "",
      nameEn: company?.nameEn || fmpProfile?.nameEn || "",
      sector: company?.sector || fmpProfile?.sector || "",
      industry: company?.industry || fmpProfile?.industry || "",
      description: fmpProfile?.description || company?.description || "",
      summary: company?.summary || [],
      risks: company?.risks || [],
      monitors: company?.monitors || [],
      pe: company?.pe || null,
      markdown: companyProfileToMarkdown ? companyProfileToMarkdown(fmpProfile) : JSON.stringify(company || fmpProfile, null, 2)
    };
  }
}
