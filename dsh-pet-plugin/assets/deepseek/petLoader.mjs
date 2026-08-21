// 鲸鱼娘 / 宠物精灵 数据驱动加载器（接入片段 · 草稿，不改 client.js 源码）
//
// 用法：把 client.js 里「根据 mood/stage 用 SVG 矢量画鲸鱼」的逻辑，
// 替换为按 manifest 取对应 PNG 的 <img>。新增宠物 = 丢一个文件夹 + 在 manifest.pets 加一条。
//
// 注意：资源已升级为 256x256 透明 APNG 动图（浏览器 <img> 原生循环播放）。
// manifest.frames 现指向 .apng 文件，加载器签名不变，直接返回动画 URL。

import manifest from './manifest.json' with { type: 'json' }

const DEFAULT_PET = manifest.defaultPet

/**
 * 取某宠物在某形态 / 某情绪下的精灵图地址。
 * @param {string} petId   宠物 id（默认 deepseek）
 * @param {string} stage   形态 baby|young|adult|legend
 * @param {string} state   情绪 normal|eat|sleep|hungry|excited|sd|pat
 * @returns {string} 图片 URL
 */
export function getPetFrame(petId = DEFAULT_PET, stage = 'baby', state = 'normal') {
  const pet = manifest.pets[petId]
  if (!pet) return ''
  const byStage = pet.frames[stage] ?? pet.frames[pet.stageOrder?.[0]]
  const file = (byStage && byStage[state]) || (byStage && byStage.normal)
  if (!file) return ''
  return new URL(`./${file}`, import.meta.url).href
}

/** 把宠物 mood(0-100) 之类内部状态映射到展示用 state（可按需扩展） */
export function moodToState(mood) {
  if (mood < 25) return 'sad'
  if (mood < 50) return 'hungry'
  return 'normal'
}

/* ===== client.js 接入示意（伪代码，替换原矢量绘制） =====
import { getPetFrame, moodToState } from './assets/deepseek/petLoader.mjs'

function renderPet(stage, mood) {
  const img = new Image()
  img.src = getPetFrame('deepseek', stage, moodToState(mood))
  petLayer.appendChild(img)   // 原 drawVectorWhale() 整段删掉
}
*/
