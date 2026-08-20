/* Circuit outlines.
   Each track is a list of waypoints in lap order, traced in a 0-100 box with
   y running down the page, the way an SVG does. The script normalises each
   trace to fill a 1000-unit box while keeping its aspect ratio, then joins
   the points with a Catmull-Rom spline converted to cubic beziers.

   Working in waypoints rather than bezier handles is the whole point: the
   shape you are trying to capture is a sequence of places the track goes,
   not a set of control points. To fix a circuit, move a point.

   `open: true` marks a trace whose two ends are the same piece of road
   crossing over itself (Suzuka), so it is not closed with a Z. */

export const TRACES = {
  /* Main straight north up the right, T1 right, the western loop, home along the bottom. */
  bahrain: { pts: [[72,86],[72,34],[68,24],[56,21],[45,25],[41,35],[47,43],[60,45],[70,42],[72,52],[62,58],[50,58],[42,64],[46,74],[38,80],[26,80],[22,86],[32,92],[50,92],[62,90]] },
  "bahrain-outer": { pts: [[72,86],[72,34],[68,24],[56,21],[45,25],[41,35],[45,50],[52,62],[50,74],[38,80],[26,80],[22,86],[32,92],[50,92],[62,90]] },
  /* A long ribbon of fast kinks up one side of the corniche and back down the other. */
  jeddah: { pts: [[42,94],[40,84],[44,76],[40,68],[44,60],[40,52],[44,44],[40,36],[43,28],[40,20],[44,12],[52,8],[60,10],[62,18],[58,26],[62,34],[58,42],[62,50],[58,58],[62,66],[58,74],[62,82],[56,90],[48,95]] },
  /* Parkland loop round the lake: rounded, no hairpins, a kink at the far end. */
  "albert-park": { pts: [[26,74],[26,40],[30,28],[40,22],[52,20],[62,24],[70,32],[72,44],[66,52],[70,62],[76,72],[70,82],[58,86],[46,84],[36,86],[28,84]] },
  /* The snail at Turns 1-4, then out to the far side and back down the long straight. */
  shanghai: { pts: [[24,78],[26,62],[32,50],[42,44],[52,42],[58,36],[56,28],[48,26],[42,30],[42,38],[48,46],[58,50],[70,52],[80,50],[86,58],[80,66],[68,70],[62,78],[66,86],[54,88],[38,86],[28,86]] },
  /* Figure of eight: the trace runs out along the esses and back under itself. */
  suzuka: { pts: [[36,90],[34,74],[38,64],[46,58],[52,50],[58,44],[66,36],[74,30],[82,28],[86,36],[80,44],[70,48],[58,50],[48,54],[40,60],[34,70],[36,80],[46,86],[60,86],[72,82],[80,74],[80,62],[72,52],[60,44],[48,38],[38,34],[30,40],[30,52],[38,60],[44,66],[42,78]] },
  /* Stadium sweeps at both ends, the awkward slow section under the freeway in the middle. */
  miami: { pts: [[24,64],[24,36],[30,26],[44,22],[60,22],[72,26],[80,36],[80,50],[74,60],[62,62],[52,66],[48,74],[40,80],[30,80],[26,72]] },
  /* Anti-clockwise, with the long spur out to the Tosa hairpin. */
  imola: { pts: [[62,86],[40,86],[30,80],[30,66],[38,58],[48,58],[54,50],[54,38],[46,32],[32,30],[22,24],[24,16],[36,14],[52,18],[66,22],[76,28],[76,42],[70,52],[60,54],[54,60],[54,70],[60,78],[70,82],[72,88]] },
  /* Sainte Devote, the climb to Casino, the Grand Hotel hairpin, the tunnel, the pool. */
  monaco: { pts: [[30,84],[28,68],[32,58],[40,54],[42,44],[38,34],[44,26],[56,22],[68,24],[76,30],[74,40],[66,44],[58,48],[60,58],[68,64],[78,62],[84,68],[82,78],[72,84],[60,82],[56,74],[50,70],[40,72],[34,78]] },
  /* Long main straight, the Turn 3 sweep out to Campsa, La Caixa, then straight home. */
  catalunya: { pts: [[24,80],[24,44],[30,34],[44,34],[54,32],[58,26],[60,18],[68,12],[78,14],[82,22],[76,48],[70,54],[62,54],[58,60],[54,70],[46,76],[36,76],[28,80]] },
  /* Two long straights, the hairpin at the far end, the wall on the way out of the last chicane. */
  montreal: { pts: [[18,72],[20,64],[26,58],[42,55],[48,50],[48,40],[54,34],[76,32],[84,38],[82,45],[74,46],[56,47],[50,52],[50,62],[44,68],[26,71]] },
  /* Ten corners, three long climbs and drops, the shortest lap of the year. */
  "red-bull-ring": { pts: [[28,86],[52,34],[60,24],[70,24],[76,32],[70,46],[66,58],[74,64],[80,74],[74,84],[60,82],[44,76],[34,78]] },
  /* Wellington straight, the arena loop, and Maggotts-Becketts running back to Stowe. */
  silverstone: { pts: [[28,56],[30,46],[46,40],[52,34],[52,22],[58,14],[74,14],[82,20],[80,42],[74,48],[62,48],[54,52],[50,62],[44,68],[36,68],[28,72],[26,80],[30,88],[42,86],[50,80],[48,70],[54,64],[70,60],[76,52],[74,42]] },
  /* Eau Rouge at the bottom, the Kemmel straight up, the long loop through the forest. */
  spa: { pts: [[32,88],[26,80],[28,70],[36,64],[38,52],[34,40],[40,30],[52,22],[66,16],[78,16],[84,24],[80,34],[70,40],[62,48],[64,58],[58,68],[50,74],[46,84],[40,90]] },
  /* Fourteen corners and almost no straight, in a natural amphitheatre. */
  hungaroring: { pts: [[26,82],[26,56],[30,48],[42,46],[48,40],[48,32],[54,24],[66,24],[72,32],[70,42],[76,48],[86,52],[86,64],[80,72],[68,72],[60,78],[58,86],[48,90],[34,88]] },
  /* Dunes: the Hugenholtz banking early, then the long banked final corner. */
  zandvoort: { pts: [[26,84],[68,84],[78,78],[78,66],[70,60],[60,60],[54,54],[52,46],[58,40],[70,38],[76,30],[76,20],[68,16],[38,20],[30,28],[34,46],[30,54],[22,58],[18,66],[22,78]] },
  /* Rettifilo, Curva Grande, the Lesmos, Ascari, and Parabolica curling back to the line. */
  monza: { pts: [[22,80],[22,26],[26,18],[34,20],[44,30],[54,42],[58,50],[64,50],[76,58],[80,66],[72,72],[58,78],[46,82],[50,88],[42,90],[32,92],[20,90],[16,84]] },
  /* New for 2026, anti-clockwise round the IFEMA halls with a banked corner. */
  madring: { pts: [[24,78],[24,52],[30,44],[42,42],[48,38],[46,26],[54,18],[72,16],[80,24],[78,40],[72,47],[62,48],[56,54],[56,62],[50,68],[40,70],[34,76],[34,84],[28,88],[22,84]] },
  /* Two kilometres flat out, and the castle squeeze at Turns 8-9. */
  baku: { pts: [[20,86],[20,30],[26,22],[40,22],[46,16],[46,10],[52,8],[60,10],[66,16],[66,24],[72,30],[80,32],[86,40],[83,80],[76,87],[26,90]] },
  /* Street grid: right angles, then the long run where the bay chicane used to be. */
  "marina-bay": { pts: [[22,82],[22,56],[26,48],[40,48],[46,42],[45,32],[52,24],[70,24],[77,32],[76,48],[80,54],[86,56],[86,70],[82,77],[62,75],[55,81],[55,88],[47,94],[26,90]] },
  /* The climb to the Turn 1 hairpin, the esses, and the long back straight to Turn 11. */
  cota: { pts: [[28,80],[28,44],[32,34],[40,32],[42,42],[38,52],[44,58],[54,58],[58,66],[56,74],[62,82],[76,82],[82,74],[80,52],[72,44],[62,44],[56,38],[56,28],[64,20],[78,16],[80,10],[40,12],[30,20]] },
  /* Thin air, the longest straight of the year, and the lap that ends in a baseball stadium. */
  mexico: { pts: [[24,86],[24,32],[28,24],[48,25],[54,19],[54,13],[62,12],[72,13],[79,21],[77,40],[70,46],[60,45],[54,51],[54,60],[47,67],[34,68],[34,76],[42,80],[52,78],[60,84],[52,90],[30,90]] },
  /* Short, steep, anti-clockwise: the Senna S down, Juncao and the long climb home. */
  interlagos: { pts: [[30,88],[30,70],[23,62],[17,52],[22,38],[31,32],[42,34],[50,29],[53,19],[62,13],[76,17],[81,26],[70,60],[61,65],[50,63],[42,69],[40,80],[31,86]] },
  /* A blast down the Strip, and not much else. */
  vegas: { pts: [[26,88],[26,76],[32,68],[72,62],[80,52],[78,40],[84,32],[84,22],[76,16],[42,20],[34,14],[26,16],[24,24],[32,30],[70,28],[76,36],[74,46],[66,54],[30,58],[22,68]] },
  /* Long constant-radius sweeps, the hardest tyre test on the calendar. */
  losail: { pts: [[25,78],[25,46],[38,32],[52,31],[60,21],[67,13],[76,12],[84,21],[81,52],[69,63],[56,63],[48,70],[47,80],[37,88],[29,86]] },
  /* Reprofiled in 2021: the old hairpin became a banked sweep, the hotel section opened up. */
  "yas-marina": { pts: [[24,80],[24,46],[32,37],[42,37],[48,30],[47,22],[55,22],[70,22],[78,30],[76,47],[68,54],[56,53],[49,60],[49,70],[42,78],[33,78],[26,86]] },
  /* Blind crests over the Algarve hills, downhill onto the main straight. */
  portimao: { pts: [[26,84],[26,62],[34,53],[44,52],[50,45],[49,35],[56,26],[70,25],[78,34],[76,52],[68,59],[58,58],[51,64],[51,73],[44,80],[34,80],[27,88]] },
  /* Ferrari's own test track: a long straight and a run of fifth-gear sweeps. */
  mugello: { pts: [[28,88],[38,34],[47,27],[56,29],[64,23],[68,16],[80,18],[86,26],[80,54],[71,60],[62,59],[54,65],[53,74],[44,80],[34,79],[27,86]] },
  /* The modern GP-Strecke, with the tight Mercedes arena hooked onto a fast loop. */
  nurburgring: { pts: [[26,80],[26,64],[32,56],[40,54],[44,46],[40,38],[44,30],[54,26],[68,28],[78,36],[80,50],[74,62],[62,66],[54,72],[54,82],[46,88],[34,88]] },
  /* Laid out through the Olympic park, defined by the endless Turn 3. */
  sochi: { pts: [[24,82],[24,70],[31,63],[38,62],[44,54],[43,46],[50,38],[50,23],[57,15],[76,15],[83,23],[83,32],[86,44],[85,62],[78,69],[64,67],[57,74],[57,82],[50,89],[30,87]] },
  /* Turn 8, a quadruple-apex left taken flat, and a long run down to the last corner. */
  istanbul: { pts: [[26,80],[26,58],[30,48],[42,46],[48,38],[44,30],[34,26],[32,18],[40,13],[52,16],[58,28],[70,30],[80,38],[78,56],[70,64],[58,62],[52,68],[52,78],[44,86],[32,86]] },
  /* Blue-and-red run-off, and the Mistral straight split by a chicane. */
  "paul-ricard": { pts: [[24,74],[24,58],[30,50],[48,48],[62,40],[76,24],[86,28],[84,50],[76,62],[60,62],[52,68],[52,78],[44,84],[28,82]] },
  /* Two enormous straights joined by a hairpin, and a wide, sweeping first sector. */
  sepang: { pts: [[26,86],[26,52],[30,42],[48,42],[54,38],[52,26],[58,17],[76,18],[84,26],[80,72],[74,80],[60,78],[54,84],[54,90],[46,90],[46,82],[38,76],[30,78]] }
};

/* -------------------------------------------------------------- geometry */

/* Catmull-Rom through every waypoint, emitted as cubic beziers.

   The fit happens after the curve is built, not before: a spline through a
   tight corner throws its control points well outside the hull of the
   waypoints, so normalising the waypoints first still leaves the drawn curve
   hanging over the edge of the box. Building first and fitting to everything
   the path actually contains keeps all 33 outlines inside the same frame. */
export function toPath(pts, { closed = true, tension = 0.5, box = 1000, pad = 90 } = {}) {
  const n = pts.length;
  const at = (i) => closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
  const segs = [];
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    segs.push([
      [p1[0] + (p2[0] - p0[0]) * tension / 3, p1[1] + (p2[1] - p0[1]) * tension / 3],
      [p2[0] - (p3[0] - p1[0]) * tension / 3, p2[1] - (p3[1] - p1[1]) * tension / 3],
      p2
    ]);
  }

  const all = [pts[0], ...segs.flat()];
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;
  const scale = (box - 2 * pad) / (Math.max(w, h) || 1);
  const ox = pad + ((box - 2 * pad) - w * scale) / 2;
  const oy = pad + ((box - 2 * pad) - h * scale) / 2;
  const fx = (x) => +(ox + (x - minX) * scale).toFixed(1);
  const fy = (y) => +(oy + (y - minY) * scale).toFixed(1);

  let d = `M ${fx(pts[0][0])} ${fy(pts[0][1])}`;
  for (const [c1, c2, p2] of segs) {
    d += ` C ${fx(c1[0])} ${fy(c1[1])} ${fx(c2[0])} ${fy(c2[1])} ${fx(p2[0])} ${fy(p2[1])}`;
  }
  return closed ? d + " Z" : d;
}
