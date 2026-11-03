// Destination presets. Picking one sets sensible defaults for everything downstream.
export const TARGETS = {
  ue5: {
    id: 'ue5', label: 'Unreal Engine 5', short: 'UE5',
    blurb: 'Adds the "root" bone Unreal expects, uses Unreal naming (SK_ / A_), keeps root motion on the root bone.',
    needsRootBone: true, meshPrefix: 'SK_', clipPrefix: 'A_', rootMotion: 'root',
    format: 'GLB (glTF binary) — Unreal 5 imports it natively, no plugins.',
    unitsNote: 'Exported in meters (glTF standard). Unreal converts to centimeters automatically on import.',
  },
  ue4: {
    id: 'ue4', label: 'Unreal Engine 4', short: 'UE4',
    blurb: 'Same as UE5, but UE4 needs the free glTF Importer plugin (Edit → Plugins).',
    needsRootBone: true, meshPrefix: 'SK_', clipPrefix: 'A_', rootMotion: 'root',
    format: 'GLB (glTF binary) — needs the glTF Importer plugin in UE4.',
    unitsNote: 'Exported in meters; the importer converts to centimeters.',
  },
  unity: {
    id: 'unity', label: 'Unity', short: 'Unity',
    blurb: 'Unity reads GLB through its official glTFast package. Root motion is optional.',
    needsRootBone: false, meshPrefix: '', clipPrefix: '', rootMotion: 'root',
    format: 'GLB — install Unity\'s "glTFast" package (Package Manager) to import it.',
    unitsNote: 'Meters — same as Unity. No conversion needed.',
  },
  godot: {
    id: 'godot', label: 'Godot 4', short: 'Godot',
    blurb: 'GLB is Godot\'s favourite format — drag and drop, nothing to install.',
    needsRootBone: false, meshPrefix: '', clipPrefix: '', rootMotion: 'root',
    format: 'GLB — native in Godot 4.',
    unitsNote: 'Meters — same as Godot.',
  },
  blender: {
    id: 'blender', label: 'Blender', short: 'Blender',
    blurb: 'For further editing. File → Import → glTF 2.0.',
    needsRootBone: false, meshPrefix: '', clipPrefix: '', rootMotion: 'hips',
    format: 'GLB — built into Blender.',
    unitsNote: 'Meters — same as Blender.',
  },
};

export const ENGINE_IDS = Object.keys(TARGETS);
