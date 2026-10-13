/**
 * 站点级常量（本站仓库地址 + 姊妹站地址）。
 *
 * 为什么单独一个文件：姊妹站地址**同时出现在两个地方** ——
 * 顶栏的 `navItems`（`components/TopBar.vue`）和页脚（`App.vue`）。
 * 之前两处各写一份字面量，改一次地址要记得改两遍，漏一处就是一条死链。
 * 收在这里之后两边都 import，不会再漂移。
 *
 * ⚠️ 姊妹站的**显示名**不放这里 —— 那要中英两份，归 `data/i18n.js` 管
 *    （`npm run check:i18n` 会核对键位，只加一边直接红）。
 *    这里只存「地址」，以及「显示名去哪个 i18n 键取」。
 */

/** 本站仓库（页脚的 GitHub 链接）。 */
export const repo = 'https://github.com/jiepijiang/jerry-tools'

/**
 * 四站的地址。
 *
 * ⚠️ 本站自己（jerry-tools）**不在里面** —— 页脚列的是「去别处」的入口，
 *    本站名字已经写在版权那一段里了（`footer.copyright · app.name`）。
 */
export const SITES = {
  /** 主站：个人门户 */
  main: 'https://jiepijiang.github.io/jerry-site/',
  /** 知识库看板 */
  notes: 'https://jiepijiang.github.io/jerry-notes/',
  /** 技能站（AI 技能分享） */
  skills: 'https://jiepijiang.github.io/jerry-skills/',
}

/**
 * 页脚里的姊妹站列表。**顺序 = 显示顺序。**
 *
 * `labelKey` 指向 `data/i18n.js` 的键 —— 别在这里写死中文，
 * 本站是中英双语的，写死会让英文界面里混进中文（第三道 i18n 守卫会红）。
 */
export const siblings = [
  { labelKey: 'footer.mainSite', href: SITES.main },
  { labelKey: 'nav.knowledgeBase', href: SITES.notes },
  { labelKey: 'nav.skillSite', href: SITES.skills },
]
