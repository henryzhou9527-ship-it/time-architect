import { useComputed } from '@preact/signals';
import { activePlan } from '../../store/plan-store';

export function WorkflowPage() {
  const agents = useComputed(() => activePlan.value.agents);

  return (
    <div class="ta-page">
      <h2 class="ta-page__title">Agent 工作流</h2>
      <div class="ta-page__card">
        <h3>配置</h3>
        <p>配置 Agent 角色和 prompt。</p>
      </div>
      {agents.value.map((agent, i) => (
        <div key={i} class="ta-page__card">
          <h3>{agent.label || agent.key}</h3>
          <div class="ta-form-grid">
            <label>模型<span>{agent.model || '未指定'}</span></label>
            {agent.job && <label>职责<span>{agent.job}</span></label>}
          </div>
        </div>
      ))}
      {agents.value.length === 0 && (
        <div class="ta-page__card">
          <p>暂无自定义 Agent（使用默认 4 Agent 配置）</p>
        </div>
      )}
    </div>
  );
}
