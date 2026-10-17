((root, factory) => {
  const engine = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = engine;
  root.BiorhythmEngine = engine;
})(typeof globalThis !== "undefined" ? globalThis : window, () => {
  "use strict";

  const CYCLES = Object.freeze({
    physical: 23,
    emotional: 28,
    intellectual: 33,
  });

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function civilDay(value) {
    if (!value) return null;
    const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
    if (!match) return null;
    return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000);
  }

  function calculateCycle(daysAlive, period) {
    const radians = (2 * Math.PI * daysAlive) / period;
    const value = Math.sin(radians);
    const direction = Math.cos(radians) >= 0 ? "rising" : "falling";
    return {
      period,
      value,
      percentage: Math.round(value * 100),
      direction,
      critical: Math.abs(value) < 0.08,
    };
  }

  function calculate({ birthDate, at = new Date(), cycles = CYCLES } = {}) {
    const birthDay = civilDay(birthDate);
    const targetDay = civilDay(at);
    if (birthDay === null || targetDay === null || targetDay < birthDay) {
      return { available: false, reason: "missing-or-invalid-birth-date" };
    }

    const daysAlive = targetDay - birthDay;
    const values = Object.fromEntries(
      Object.entries(cycles).map(([name, period]) => [name, calculateCycle(daysAlive, Number(period))])
    );
    const percentages = Object.values(values).map(item => item.percentage);
    const average = percentages.reduce((sum, value) => sum + value, 0) / Math.max(1, percentages.length);

    return {
      available: true,
      method: "traditional-sine-cycles",
      daysAlive,
      cycles: values,
      aggregatePercentage: Math.round(average),
      score: clamp(Math.round((average + 100) / 2), 0, 100),
    };
  }

  return Object.freeze({ CYCLES, calculate, calculateCycle, civilDay });
});
