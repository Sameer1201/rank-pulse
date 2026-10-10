export type ActivityCurveMetric = 'correct' | 'wrong' | 'unanswered' | 'minutes' | 'total';
export type ActivityCurveDay = { date: string; partial: boolean } & Record<ActivityCurveMetric, number | null>;
const keys: ActivityCurveMetric[] = ['correct', 'wrong', 'unanswered', 'minutes', 'total'];
const sixHours = 6 * 60 * 60 * 1000;

/** Chart-only interpolation, never an intraday observation or a daily total. */
export function activityCurvePoints<T extends ActivityCurveDay>(days: T[]) {
  return days.flatMap((day, index) => {
    const timestamp = Date.parse(`${day.date}T00:00:00Z`);
    const next = days[index + 1];
    const points = [{ ...day, timestamp, estimated: false }];
    // Do not extrapolate beyond recorded dates or bridge missing calendar days.
    if (!next || Date.parse(`${next.date}T00:00:00Z`) - timestamp !== 4 * sixHours
      || !keys.some(key => day[key] !== null && next[key] !== null)) return points;
    for (let step = 1; step < 4; step++) {
      const t = step / 4;
      // Cubic Hermite easing: exact endpoints, zero endpoint slopes, no
      // overshoot. The shared weight also keeps total = sum of answers.
      const weight = t * t * (3 - 2 * t);
      const values = Object.fromEntries(keys.map(key => {
        const from = day[key], to = next[key];
        return [key, from !== null && to !== null ? from + (to - from) * weight : null];
      })) as Record<ActivityCurveMetric, number | null>;
      points.push({ ...day, ...values, timestamp: timestamp + step * sixHours, estimated: true });
    }
    return points;
  });
}
