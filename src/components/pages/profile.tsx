import { useComputed } from '@preact/signals';
import { profile } from '../../store/plan-store';

export function ProfilePage() {
  const p = useComputed(() => profile.value);

  return (
    <div class="ta-page">
      <h2 class="ta-page__title">用户画像</h2>
      <div class="ta-page__card">
        <h3>基本信息</h3>
        <div class="ta-form-grid">
          <label>名称<span>{p.value.name}</span></label>
          <label>时区<span>{p.value.timezone}</span></label>
          <label>生活阶段<span>{p.value.currentLifeStage || '未设置'}</span></label>
          <label>角色<span>{p.value.roles.length ? p.value.roles.join(', ') : '未设置'}</span></label>
        </div>
      </div>
      <div class="ta-page__card">
        <h3>作息 & 容量</h3>
        <div class="ta-form-grid">
          <label>睡眠窗口<span>{p.value.sleepWindow}</span></label>
          <label>每周容量<span>{p.value.weeklyCapacityHours}h</span></label>
          <label>规划风格<span>{p.value.planningStyle}</span></label>
        </div>
      </div>
      <div class="ta-page__card">
        <h3>能量模式</h3>
        <div class="ta-form-grid">
          <label>高专注时间<span>{p.value.energyPattern.highFocusTime || '待校准'}</span></label>
          <label>低能量时间<span>{p.value.energyPattern.lowEnergyTime || '待校准'}</span></label>
        </div>
      </div>
      <div class="ta-page__card">
        <h3>其他</h3>
        <div class="ta-form-grid">
          <label>固定安排<span>{p.value.fixedCommitments || '无'}</span></label>
          <label>常见失败模式<span>{p.value.commonFailureModes.join(', ') || '未记录'}</span></label>
        </div>
      </div>
    </div>
  );
}
