import { useComputed } from '@preact/signals';
import { activePlan, navigateWeek, goToCurrentWeek } from '../../store/plan-store';
import { DayColumn } from './day-column';
import { weekRangeLabel, dateForDay, formatDate, currentDayIndex } from '../../engine/date-utils';

const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const BOARD_HEIGHT = 1536;

export function CalendarBoard() {
  const planData = useComputed(() => activePlan.value);
  const weekLabel = useComputed(() => weekRangeLabel(planData.value.weekStart));
  const todayIndex = useComputed(() => currentDayIndex(planData.value.weekStart));

  return (
    <div class="ta-calendar">
      <div class="ta-calendar__head">
        <div class="ta-calendar__week-nav">
          <button class="ta-calendar__week-btn" onClick={() => navigateWeek(-1)}>◀</button>
          <span class="ta-calendar__week-label" onClick={goToCurrentWeek} style={{ cursor: 'pointer' }}>{weekLabel}</span>
          <button class="ta-calendar__week-btn" onClick={() => navigateWeek(1)}>▶</button>
        </div>
        <div class="ta-calendar__day-headers">
          <div class="ta-calendar__time-corner" />
          {DAY_NAMES.map((name, i) => (
            <div key={i} class={`ta-calendar__day-head${todayIndex.value === i ? ' ta-calendar__day-head--today' : ''}`}>
              <span class="ta-calendar__day-name">{name}</span>
              <span class="ta-calendar__day-date">{dateForDay(planData.value.weekStart, i).slice(8)}</span>
            </div>
          ))}
        </div>
      </div>
      <div class="ta-calendar__scroll">
        <div class="ta-calendar__board">
          <div class="ta-calendar__time-axis">
            {HOURS.map(h => (
              <div
                key={h}
                class="ta-calendar__time-label"
                style={{ top: `${(h / 24) * BOARD_HEIGHT}px` }}
              >
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>
          {DAY_NAMES.map((_, i) => (
            <DayColumn
              key={i}
              dayIndex={i}
              weekStart={planData.value.weekStart}
              isToday={todayIndex.value === i}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
