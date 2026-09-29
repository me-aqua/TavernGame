<script setup lang="ts">
/**
 * 左栏那颗「新建一枝」开的那张面板（票 8e）：六选一 ⇒ 那个形状的必收项 ⇒ 建出来。
 *
 * ⚠️ **只画 + 把值收在自己手上**：规矩（名字三条 · 三种必收项 · 怎么拼 schema）都在
 *    `useBranchCreate.ts` 的 `planBranch` 里 —— 这一层只把输入收齐、问一句、把判决摆出来。
 * ⚠️ **面板的命跟着 `v-if` 走**（`CardEditor` 那颗按钮开合它）⇒ 每次打开都是一个**新实例**、
 *    那几格就是干净的 —— 不需要任何"重置表单"的代码（敲了一半关掉的东西不该留到下次）。
 * ⚠️ 被拒时**表单不关、值都还在**（作者补上缺的那一样就能接着建），只多一句 `data-branch-problem`。
 * ⚠️ 点按区 ≥24×24（`e2e/probe.ts` 数 button 的矩形）· 字号只用 `--fs1/2/3` 三档（整页巡检数档数）。
 * ⚠️ 控件折行排（左栏只有 300px）：面板自己的 `flex-wrap` 兜住，不给整页加横向溢出。
 * ⚠️ 六种形状的**显示名复用 `card.kind.*`**（票 70 落的：文字 / 数字 / 下拉 / 数组 / 字典 / 结构体）——
 *    同一件事不开第二族 locale 键。
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { planBranch, SCALARS, SHAPES, type CreateInput, type Shape } from './useBranchCreate'
import type { Schema } from '../game/card-state'

const { t } = useI18n()

const props = defineProps<{
  /** 已经占掉的名字（卡里已有的顶层枝 + 草稿里刚建的）—— 重名由 `planBranch` 挡 */
  taken: string[]
}>()

const emit = defineEmits<{
  /** 建出来的一枝：名字 + 拼好的 schema（`CardEditor` 把它收进草稿） */
  make: [name: string, schema: Schema]
}>()

/** 面板那几格（`shape` 空串 = 还没六选一：那时「建出来」按不动） */
const form = ref<Omit<CreateInput, 'shape'> & { shape: Shape | '' }>({
  shape: '',
  name: '',
  values: '',
  of: '',
  key: '',
  field: 'string',
})
/** 上一次「建出来」被拒的那句人话（空串 = 没有） */
const problem = ref('')

/** 「建出来」：先问规矩，过了才抛给外面；没过就把那句话摆出来（表单一个字都不动） */
function make(): void {
  const shape = form.value.shape
  if (shape === '') return
  const verdict = planBranch({ ...form.value, shape }, props.taken)
  if ('problem' in verdict) {
    problem.value = verdict.problem
    return
  }
  problem.value = ''
  emit('make', form.value.name.trim(), verdict.schema)
}
</script>

<template>
  <div data-branch-create class="create">
    <p v-text="t('card.branchNew')" />
    <button
      v-for="shape in SHAPES"
      :key="shape"
      type="button"
      :data-branch-shape="shape"
      :data-branch-shape-on="shape === form.shape ? '' : null"
      v-text="t('card.kind.' + shape)"
      @click="form.shape = shape"
    />
    <input v-model="form.name" data-branch-name type="text" :placeholder="t('card.fieldKey')" />
    <input
      v-if="form.shape === 'enum'"
      v-model="form.values"
      data-branch-values
      type="text"
      placeholder="a, b"
    />
    <template v-if="form.shape === 'list' || form.shape === 'map'">
      <button
        v-for="one in SCALARS"
        :key="one"
        type="button"
        :data-branch-of="one"
        :data-branch-of-on="one === form.of ? '' : null"
        v-text="t('card.kind.' + one)"
        @click="form.of = one"
      />
    </template>
    <template v-if="form.shape === 'object'">
      <input v-model="form.key" data-branch-field-key type="text" :placeholder="t('card.fieldKey')" />
      <button
        v-for="one in SCALARS"
        :key="one"
        type="button"
        :data-branch-field-shape="one"
        :data-branch-field-shape-on="one === form.field ? '' : null"
        v-text="t('card.kind.' + one)"
        @click="form.field = one"
      />
    </template>
    <p v-if="problem" data-branch-problem class="create-problem" v-text="problem" />
    <button
      type="button"
      data-branch-make
      :disabled="form.shape === ''"
      v-text="t('card.branchNew')"
      @click="make"
    />
  </div>
</template>

<style scoped>
/* 面板：贴在左栏那颗按钮下面，控件折行排、谁也不撑宽那一栏（巡检量横向溢出） */
.create {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s1);
  min-width: 0;
  margin-top: var(--s2);
  padding: var(--s2);
  border: 1px solid var(--color-line);
  border-radius: var(--r2);
  background: var(--color-surface-2);
  font-size: var(--fs2);
}
/* 面板名与那句被拒的原因：各占一行，不用跟控件挤 */
.create p {
  flex: 1 0 100%;
  margin: 0;
}
/* 面板里的控件：点按区 ≥24 高（`e2e/probe.ts` 数 button 的矩形），框与字照项目里那一套 */
.create button,
.create input {
  min-height: 24px;
  padding: 0 var(--s1);
  border: 1px solid var(--color-line);
  border-radius: var(--r2);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: inherit;
  font-size: var(--fs2);
}
/* 名字 / 白名单 / 第一个字段那三格：分掉剩下的宽，窄了就自己折一行 */
.create input {
  flex: 1 1 6rem;
  min-width: 0;
}
/* 选中的那个（形状 / 元素形状 / 字段形状）与「建出来」：强调色（它是选中态，不只靠颜色） */
.create [data-branch-shape-on],
.create [data-branch-of-on],
.create [data-branch-field-shape-on],
.create [data-branch-make] {
  border-color: var(--color-accent-line);
  color: var(--color-accent);
  cursor: pointer;
}
/* 还没六选一：「建出来」按不动（灰掉，不假装能按） */
.create [data-branch-make]:disabled {
  border-color: var(--color-line);
  color: var(--color-faint);
  cursor: default;
}
/* 被拒的那句人话：危险色（与中栏那条保存失败同一套色） */
.create-problem {
  color: var(--color-danger);
  line-height: 1.5;
}
</style>
