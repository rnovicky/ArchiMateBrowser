// Offline copy (2.20.0): the API's layer of every element type (its app/services/layers.py), by the
// API's layer keys. The Browser's own table (archimate.js LAYERS) has the same grouping under other keys.

export const LAYER_TYPES = {
  Strategy: ['Resource', 'Capability', 'CourseOfAction', 'ValueStream'],
  Business: ['BusinessActor', 'BusinessRole', 'BusinessCollaboration', 'BusinessInterface', 'BusinessProcess', 'BusinessFunction',
    'BusinessInteraction', 'BusinessEvent', 'BusinessService', 'BusinessObject', 'Contract', 'Representation', 'Product'],
  Application: ['ApplicationComponent', 'ApplicationCollaboration', 'ApplicationInterface', 'ApplicationFunction',
    'ApplicationInteraction', 'ApplicationProcess', 'ApplicationEvent', 'ApplicationService', 'DataObject'],
  Technology: ['Node', 'Device', 'SystemSoftware', 'TechnologyCollaboration', 'TechnologyInterface', 'Path', 'CommunicationNetwork',
    'TechnologyFunction', 'TechnologyProcess', 'TechnologyInteraction', 'TechnologyEvent', 'TechnologyService', 'Artifact'],
  Physical: ['Equipment', 'Facility', 'DistributionNetwork', 'Material'],
  Motivation: ['Stakeholder', 'Driver', 'Assessment', 'Goal', 'Outcome', 'Principle', 'Requirement', 'Constraint', 'Meaning', 'Value'],
  ImplementationMigration: ['WorkPackage', 'Deliverable', 'ImplementationEvent', 'Plateau', 'Gap'],
  Other: ['Grouping', 'Location', 'AndJunction', 'OrJunction'],
};

export const LAYER_LABELS = {
  Strategy: 'Strategy', Business: 'Business', Application: 'Application', Technology: 'Technology', Physical: 'Physical',
  Motivation: 'Motivation', ImplementationMigration: 'Implementation & Migration', Other: 'Other',
};

/** Element type -> its layer's key. */
export const LAYER_OF = Object.fromEntries(Object.entries(LAYER_TYPES).flatMap(([layer, types]) => types.map(t => [t, layer])));

/** Element type -> its layer's label (the impact CSV's "layer"). */
export const LAYER_LABEL_OF = Object.fromEntries(Object.entries(LAYER_OF).map(([t, layer]) => [t, LAYER_LABELS[layer]]));
