# 宠物自动喂食插件 — 通用设计方案

## 概述

一种 Agent 工具插件，在用户与 AI Agent 交互的过程中（用户输入、LLM 回答、工具调用）**自动触发虚拟宠物喂食**，并在前端展示带 Combo 连击的组合特效。可嵌入任何支持事件系统的 Agent 框架。

---

## 核心机制

### 事件触发源

| 触发源 | 说明 | 基础经验值 |
|--------|------|-----------|
| 用户输入 | 用户发送消息 | 1 |
| LLM 生成 | 模型回复一次 generation | 2 |
| 工具调用 | 工具执行返回结果 | 3 |

### Token → 食物量映射

```
foodAmount = clamp(tokens / 100, 1, 15) × comboMultiplier
expAmount  = baseExp × comboMultiplier
```

- 用户输入：tokens ≈ 输入字符数 / 4
- LLM 生成：tokens = output_tokens（从 API usage 获取）
- 工具调用：tokens = 结果字节数 / 4

### Combo 连击机制

```
窗口时长：5 秒
最大连击：10 次
倍率公式：multiplier = 1.0 + 0.2 × min(comboCount, 10)
最高倍率：3.0x

规则：
- 每次事件重置 5 秒计时器
- comboCount 从 1 开始累加
- 超时后 comboCount 重置为 0
- 工具循环天然产生密集事件，自然形成高 combo
```

---

## 架构设计

### 数据流

```
Agent EventBus                      Pet System
───────────────                     ──────────
user_input         ─┐
llm_generation     ─┼─→ FeedBridge ─→ AutoFeed Event ─→ PetState 更新
tool_result        ─┘       │                              │
                      token→食物量计算                      ↓
                      combo 状态维护               WebSocket Push
                            │                      (FeedEffect msg)
                            │                              │
                            └──────────────────────→ Frontend 特效
```

### 后端组件

#### 1. `AutoFeedEvent`（事件定义）

```
{
  player_id: string
  pet_id: string
  food_amount: int        // 计算后的食物量
  exp_amount: int         // 计算后的经验值
  feed_source: string     // "user_input" | "generation" | "tool_result"
  combo_count: int        // 当前连击数
  combo_multiplier: float // 当前倍率
  timestamp: long
}
```

#### 2. `FeedBridge`（事件桥接器）

职责：
- 订阅 Agent 框架的事件总线（user_input / generation / tool_result）
- 维护 Combo 状态（线程安全的计数器 + 超时重置）
- 计算 foodAmount 和 expAmount
- 发射 AutoFeedEvent 到宠物系统
- 推送 FeedEffect 消息到前端 WebSocket

关键实现点：
- `synchronized` 保证 combo 状态一致性
- 遍历所有在线 session 的宠物进行喂食
- 独立于 Agent 核心逻辑，纯监听者模式

#### 3. `PetState`（宠物状态）

```
{
  name: string
  species: string
  mood: 0-100
  hunger: 0-100     // feed 降低 hunger
  energy: 0-100
  exp: int
  level: int        // exp 达到 level×100 后升级
}
```

`feed(amount)` → `hunger = max(0, hunger - amount)`, `exp += 5`

#### 4. `FeedEffect`（前端推送消息）

```json
{
  "type": "feed_effect",
  "scope": "pet",
  "petEntityId": "pet_xxx",
  "foodAmount": 3,
  "expAmount": 6,
  "source": "tool_result",
  "comboCount": 5,
  "comboMultiplier": 2.0
}
```

---

### 前端组件

#### 1. `useFeedEffect` (状态管理)

- 监听 WebSocket `feed_effect` 消息
- 维护活跃特效列表（TTL 2.2秒自动清除）
- 维护前端 combo 展示状态
- 5秒无新事件后重置 combo 显示
- 暴露：`{ effects, comboCount, comboMultiplier, comboTier, addEffect }`

#### 2. `FeedEffectLayer` (特效渲染)

**三阶段组合动画：**

| 阶段 | 时长 | 效果 |
|------|------|------|
| 食物飞入 | 600ms | 食物图标从下方弹跳飞入宠物位置（贝塞尔曲线） |
| 宠物进食 | 400ms | 宠物 bounce 动画 + 嘴部动作 |
| 飘字消散 | 1200ms | `+N 🍖` `+N ⭐` 向上飘出渐隐 |

**Combo 视觉升级：**

| Combo | 等级 | 视觉效果 |
|-------|------|---------|
| 1-3 | normal | 白色飘字，普通大小 |
| 4-6 | gold | 金色飘字 + 轻微震动 + 金色光晕 |
| 7-10 | epic | 彩虹渐变 + 强震 + 光环脉冲 + 大字号 |

**食物图标映射：**
- user_input → 🥕（萝卜）
- generation → 🐟（鱼）
- tool_result → 🍖（肉）

---

## 接入 Agent 框架的适配层

### 接口契约

插件需要 Agent 框架提供以下 hook 点：

```typescript
interface AgentEventHook {
  onUserInput(input: string): void
  onGeneration(response: { outputTokens: number }): void
  onToolResult(result: { resultBytes: number }): void
}
```

### 最小集成示例（伪代码）

```python
class PetFeedPlugin:
    def __init__(self, pet_state, ws_sender):
        self.combo = ComboTracker(window_ms=5000, max_count=10)
        self.pet = pet_state
        self.sender = ws_sender

    def on_user_input(self, text):
        tokens = len(text) // 4
        self._feed("user_input", tokens, base_exp=1)

    def on_generation(self, output_tokens):
        self._feed("generation", output_tokens, base_exp=2)

    def on_tool_result(self, result_bytes):
        tokens = max(result_bytes // 4, 1)
        self._feed("tool_result", tokens, base_exp=3)

    def _feed(self, source, tokens, base_exp):
        self.combo.tick()
        m = self.combo.multiplier
        food = clamp(int(tokens / 100 * m + 0.5), 1, 15)
        exp = max(1, int(base_exp * m + 0.5))
        self.pet.feed(food, exp)
        self.sender.push_feed_effect(food, exp, source, self.combo.count, m)
```

### ComboTracker（独立可复用）

```python
class ComboTracker:
    def __init__(self, window_ms=5000, max_count=10):
        self.window_ms = window_ms
        self.max_count = max_count
        self.count = 0
        self.last_time = 0

    def tick(self):
        now = current_time_ms()
        if now - self.last_time > self.window_ms:
            self.count = 0
        self.count = min(self.count + 1, self.max_count)
        self.last_time = now

    @property
    def multiplier(self):
        return 1.0 + 0.2 * self.count
```

---

## 配置项（建议暴露给用户）

| 配置键 | 默认值 | 说明 |
|--------|--------|------|
| `pet.auto_feed.enabled` | true | 是否启用自动喂食 |
| `pet.auto_feed.combo_window_ms` | 5000 | Combo 窗口时长 |
| `pet.auto_feed.max_combo` | 10 | 最大连击数 |
| `pet.auto_feed.min_food` | 1 | 单次最小食物量 |
| `pet.auto_feed.max_food` | 15 | 单次最大食物量 |
| `pet.auto_feed.tokens_per_food` | 100 | 多少 token 换 1 食物 |
| `pet.effects.enabled` | true | 前端特效开关 |
| `pet.effects.ttl_ms` | 2200 | 单条特效显示时长 |

---

## 扩展点

1. **更多事件源**：错误重试、上下文压缩、会话恢复等都可以作为喂食源
2. **食物种类**：不同事件类型产出不同食物，宠物有偏好，影响心情
3. **成就系统**：首次达到 combo x10、喂食 1000 次等解锁成就
4. **多宠物**：支持多只宠物，用户选择当前活跃宠物
5. **宠物进化**：达到特定等级后可以进化，改变外观和属性
6. **被动效果**：高等级宠物提供 buff（如提示建议、快捷操作）

---

## 前端 CSS 动画参考

核心 keyframes：

```css
/* 食物弹入 */
@keyframes fly-in {
  0%   { opacity: 0; transform: translateY(40px) scale(0.3); }
  60%  { opacity: 1; transform: translateY(-5px) scale(1.2); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

/* 数字飘散 */
@keyframes float-up {
  0%   { opacity: 0; transform: translateY(0); }
  30%  { opacity: 1; transform: translateY(-8px); }
  100% { opacity: 0; transform: translateY(-30px); }
}

/* 宠物进食弹跳 */
@keyframes eat-bounce {
  0%, 100% { transform: scale(1); }
  30%      { transform: scale(1.15) rotate(-3deg); }
  60%      { transform: scale(0.95) rotate(2deg); }
}

/* 彩虹渐变 (epic combo) */
@keyframes rainbow-shift {
  0%   { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
}

/* 光环脉冲 */
@keyframes glow-pulse {
  0%, 100% { opacity: 0.6; transform: scale(1); }
  50%      { opacity: 1; transform: scale(1.1); }
}
```

---

## 总结

该方案的核心是一个**事件驱动的喂食桥接器**，通过 Combo 机制让频繁的 Agent 交互（尤其是工具循环）产生越来越大的视觉反馈，形成正循环的趣味性。设计完全解耦于具体 Agent 框架，只需对方提供 3 个事件 hook 即可集成。
