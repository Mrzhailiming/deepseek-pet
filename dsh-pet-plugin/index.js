/**
 * 宠物自动喂食插件，node 半。
 *
 * 纯 UI 插件：空 apply 的存在只是为了让这个包出现在 Loader 的 entry 列表里。
 * client-modules 的扫描要求「一条活着的、未 disable 的 loader entry，其
 * options.name 等于包名」，所以这一半必须是一个合法的 cordis 插件模块；
 * 真正的行为全部在 exports["./client"] 的浏览器半。
 */

/** Host 侧插件体 —— 本插件没有任何 host 行为。 */
export function apply() {}
