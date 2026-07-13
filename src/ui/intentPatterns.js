// Browser and server share these discovery-intent rules. This module lives in
// src/ui because that directory is part of the legacy app's static whitelist.
const SCREEN_VERB = /帮我筛|筛选|筛一下|筛一筛|筛出|选股|挑(几只|一些|几个|出)|找(几只|一些|几个)|有(哪些|什么).{0,12}(股票|公司|标的)(值得|可以|推荐)?/;
const SCREEN_COND = /(PE|PB|市盈率|市净率|市值|股息率?|分红率?|价格|营收增速|增速)\s*(小于|大于|低于|高于|超过|不到|少于|多于|以上|以下|<|>|≤|≥|＜|＞)/i;
const MACRO_SIGNAL = /大盘|宏观|美联储|议息|加息|降息|非农|CPI|PPI|通胀|国债收益率|流动性|美股(今晚|今天|今年|本周|下周|最近|接下来|怎么|如何|行情|市场)|港股(今晚|今天|本周|大盘|行情|市场|最近|怎么)|恒生指数|恒指|纳斯达克|纳指|标普|道琼斯|道指|指数(怎么|如何|走势)|今晚.{0,10}(关键事件|有什么事件|数据|财报|事件)|市场情绪|风险偏好|宏观经济/;

export function isScreenerQuestion(question = "") {
  const text = String(question || "");
  return SCREEN_VERB.test(text) || SCREEN_COND.test(text);
}

export function isMacroQuestion(question = "") {
  return MACRO_SIGNAL.test(String(question || ""));
}
