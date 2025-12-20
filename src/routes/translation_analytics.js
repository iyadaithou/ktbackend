const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

// GET /api/analytics/translation
// Returns aggregate timing metrics from translation_order_events
router.get('/translation', async (req, res) => {
  try {
    const { from, to } = req.query;

    // Load events (optionally by date range)
    let query = supabase
      .from('translation_order_events')
      .select('*')
      .order('occurred_at', { ascending: true });

    if (from) query = query.gte('occurred_at', from);
    if (to) query = query.lte('occurred_at', to);

    const { data: events, error } = await query;
    if (error) return res.status(500).json({ error: 'Failed to load events' });

    // Group events by order
    const orderIdToEvents = new Map();
    for (const e of events) {
      if (!orderIdToEvents.has(e.order_id)) orderIdToEvents.set(e.order_id, []);
      orderIdToEvents.get(e.order_id).push(e);
    }

    // Compute metrics
    let totalTurnaroundMs = 0;
    const stageDurations = {}; // { stageName: [durations...] }
    let numOrders = 0;

    for (const [orderId, evts] of orderIdToEvents.entries()) {
      if (evts.length === 0) continue;
      numOrders++;
      // sort just in case
      evts.sort((a,b) => new Date(a.occurred_at) - new Date(b.occurred_at));

      const first = evts[0];
      const last = evts[evts.length - 1];
      totalTurnaroundMs += (new Date(last.occurred_at) - new Date(first.occurred_at));

      for (let i = 1; i < evts.length; i++) {
        const prev = evts[i-1];
        const curr = evts[i];
        const duration = new Date(curr.occurred_at) - new Date(prev.occurred_at);
        const prevStage = prev.to_list_name || prev.from_list_name || 'Unknown';
        if (!stageDurations[prevStage]) stageDurations[prevStage] = [];
        stageDurations[prevStage].push(duration);
      }
    }

    const msToHrs = ms => (ms / 3600000);
    const avg = arr => arr.length ? arr.reduce((a,b) => a+b, 0) / arr.length : 0;
    const p = (arr, q) => {
      if (!arr.length) return 0;
      const s = [...arr].sort((a,b) => a-b);
      const idx = Math.floor(q * (s.length - 1));
      return s[idx];
    };

    const stageStats = Object.entries(stageDurations).map(([stage, arr]) => ({
      stage,
      avgHours: Number(msToHrs(avg(arr)).toFixed(2)),
      p50Hours: Number(msToHrs(p(arr, 0.5)).toFixed(2)),
      p90Hours: Number(msToHrs(p(arr, 0.9)).toFixed(2)),
      samples: arr.length,
    }));

    const response = {
      ordersMeasured: numOrders,
      avgTurnaroundHours: numOrders ? Number(msToHrs(totalTurnaroundMs / numOrders).toFixed(2)) : 0,
      stages: stageStats,
    };

    res.json(response);
  } catch (e) {
    console.error('analytics error', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;



