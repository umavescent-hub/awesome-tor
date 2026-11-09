# Gathered Ground

*The algorithmic philosophy behind Tsideh's generative art. It guides `public/js/art.js` and the dot texture,
and is explored interactively in the Gathered Ground art lab.*

Gathered Ground is a philosophy of convergence: scattered matter that finds a place, holds it for a while, and
leaves the ground changed. Every piece begins as dispersal, a field of dots strewn across the canvas like people
spread across a valley, and ends as a gathering, the same dots settled into a terraced spiral around a single
seeded center. Nothing is placed by hand. The image is the residue of a process: the moment a crowd becomes a table.

The ground is a lattice. Each dot belongs to a hexagonal grid, and its final size is read from a scalar field that
the algorithm composes from three forces. A logarithmic spiral contributes the pull of the center, measured as each
point's distance to the nearest arm in log-polar space, so the arms tighten inward with the same ratio at every
scale. Terrace quantization breaks that smooth pull into discrete steps, so dot radii climb in flat, deliberate
levels the way a hillside is cut into fields. A low-frequency noise field adds breath, a slow irregularity that
keeps the geometry from reading as a diagram. The lattice is a halftone: tone appears only through the size of
identical marks, so the whole image is one material at one grain.

Motion is the work. Dots enter as particles on a river-shaped current, a seeded noise path that crosses the canvas
the way water crosses dry country, and spring toward their lattice homes through a damped swirl around the spiral's
center. They grow as they arrive. When the gathering settles, the field keeps breathing: a slow wave travels outward
along the spiral coordinate and the dot radii rise and fall with it, never enough to disturb the terraces. Then,
and only then, small kelly-green sprouts open at the highest terraces, the last thing to happen and the reason the
gathering took place. Each of these timings must feel inevitable, the product of painstaking calibration by someone
who has watched the system run a thousand times and removed every motion that did not earn its place.

Color is restricted to four values and assigned by rule, never by chance: a ground of adobe orange, black for the
working dots, cream for the forms the field marks as solid, and kelly green held back for stripes and sprouts. One
feather band, three parallel kelly stripes closed by a black sawtooth, is laid along the tangent of the outer arm,
built from the same dots as everything else so that it reads as part of the ground rather than an ornament on it.
Restraint here is a discipline of master-level craft: four colors, one grain, one center, and nothing added that
the field did not produce.

Seeds are places. A seed chooses where the center falls, how tightly the arms wind, how many terraces the field cuts,
where the river enters, and where the band and sprouts appear, and the same seed must always produce the same
gathering, frame for frame. Parameters are few and physical: grain, winding, arm width, terrace count, breath,
gathering speed, sprouts. Every default is the result of meticulous tuning, so that seed 1 and seed 100,000 are
equally finished: complexity without noise, order without rigidity, and the unmistakable sense of a meticulously
crafted algorithm made by hand over a long time.
