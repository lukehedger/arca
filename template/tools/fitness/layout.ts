// A top-level directory holds its modules directly, so a path names the layer and the module with nothing between.
export const LAYERS = ['api', 'async', 'core', 'infra'] as const;

export const findNestedSources = (
  exists: (path: string) => boolean,
): string[] =>
  LAYERS.filter((layer) => exists(`${layer}/src`)).map(
    (layer) =>
      `Layout: \`${layer}/src/\` exists. Move its contents into \`${layer}/\` and delete it. A top-level directory holds its modules directly.`,
  );
