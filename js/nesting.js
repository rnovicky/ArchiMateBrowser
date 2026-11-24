// Nesting in generated diagrams (LV-5, optional): draw Composition and
// Aggregation (optionally Assignment) as nested boxes, as Archi does,
// instead of lines. Shared by the ELK layout and the PlantUML generator.

/** Relationship types that can be shown as nesting, in order of preference. */
export const NESTING_TYPES = ['Composition', 'Aggregation', 'Assignment'];

/**
 * The nesting the API returns with a diagram (graph.js turns it into this shape), as the ELK layout
 * and the PlantUML generator use it:
 *   parentOf: Map child element id → parent element id
 *   nestedRelIds: Set of the relationships shown by nesting (not drawn as lines)
 *   ancestorEdgeIds: Set of the other relationships between an element and one of its ancestors;
 *                    they cannot be drawn (the line would run inside the box) and are left out
 * The rules (one parent per element, no cycles, junctions never nested) are the API's.
 */
