/**
 * Derive structured pattern observations from signal groups.
 * Patterns are observations, not AI conclusions or diagnoses.
 */

/**
 * Extract patterns from a signals object.
 * Only includes segments with evidence status better than insufficient
 * when they show a material difference vs baseline, or always includes
 * global signals (risk, exit efficiency, streaks) when present.
 *
 * @param {object} signals  output of getBehaviorSignals
 * @returns {Array<object>}
 */
function derivePatterns(signals) {
  const patterns = [];
  if (!signals) return patterns;

  const pushSeg = (list, type) => {
    for (const s of list || []) {
      if (!s || !s.evidence) continue;
      if (s.evidence.status === "insufficient") continue;
      const diff =
        s.difference && typeof s.difference === "object"
          ? s.difference.averageR
          : s.difference;
      patterns.push({
        type,
        dimension: s.dimension,
        segment: s.segment || s.bucket || null,
        sampleSize: s.sampleSize,
        difference: diff == null ? null : Number(diff),
        evidence: {
          status: s.evidence.status,
          confidenceLevel: s.evidence.confidenceLevel,
        },
      });
    }
  };

  pushSeg(signals.segments, "segment_performance");
  pushSeg(signals.confidence, "confidence_calibration");
  pushSeg(signals.emotions, "emotion_segment");
  pushSeg(signals.ruleScore, "rule_score");
  pushSeg(signals.mistakes, "mistake_impact");

  if (signals.risk && signals.risk.evidence) {
    patterns.push({
      type: "risk_consistency",
      dimension: "risk",
      segment: null,
      sampleSize: signals.risk.sampleSize,
      difference: signals.risk.deviationPercent,
      evidence: {
        status: signals.risk.evidence.status,
        confidenceLevel: signals.risk.evidence.confidenceLevel,
      },
    });
  }

  if (signals.exitEfficiency && signals.exitEfficiency.evidence) {
    patterns.push({
      type: "exit_efficiency",
      dimension: "exit_efficiency",
      segment: null,
      sampleSize: signals.exitEfficiency.sampleSize,
      difference: signals.exitEfficiency.averageCaptureRatio,
      evidence: {
        status: signals.exitEfficiency.evidence.status,
        confidenceLevel: signals.exitEfficiency.evidence.confidenceLevel,
      },
    });
  }

  if (signals.streaks && signals.streaks.evidence) {
    patterns.push({
      type: "streaks",
      dimension: "streaks",
      segment: null,
      sampleSize: signals.streaks.sampleSize,
      difference: null,
      longestWinStreak: signals.streaks.longestWinStreak,
      longestLossStreak: signals.streaks.longestLossStreak,
      evidence: {
        status: signals.streaks.evidence.status,
        confidenceLevel: signals.streaks.evidence.confidenceLevel,
      },
    });
  }

  return patterns;
}

/**
 * Empty signals payload (no NaN / Infinity).
 */
function emptySignals() {
  return {
    segments: [],
    confidence: [],
    emotions: [],
    ruleScore: [],
    risk: null,
    exitEfficiency: null,
    mistakes: [],
    streaks: null,
  };
}

module.exports = {
  derivePatterns,
  emptySignals,
};
