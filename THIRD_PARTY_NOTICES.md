# Third-party notices

JustRigIt (AGPL-3.0-or-later, by SuddleMercury) includes or uses the following. Each keeps its own licence.

## Included in JustRigIt (the app, `dist/justrigit.html`, and the Claude Desktop extension)
| Component | Licence | Copyright |
|---|---|---|
| [three.js](https://github.com/mrdoob/three.js) | MIT | © 2010–2026 three.js authors |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | MIT | © Garrett Johnson |
| [fflate](https://github.com/101arrowz/fflate) | MIT | © 2023 Arjun Barrett |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) (`@modelcontextprotocol/sdk`) and its dependencies | MIT | © Anthropic, PBC and contributors |
| [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas) (extension only, image/texture support) | MIT | © 2021 LongYinan |

The built-in animation library and the practice mannequin are original work, part of JustRigIt.

## Downloaded by `Install-Capture.bat` (not included in this repository)
Video motion capture installs these from their official sources onto your computer. You accept their licences
when you run the installer.

| Component | Licence |
|---|---|
| [NVIDIA GEM-X](https://github.com/NVlabs/GEM-X) code | Apache 2.0 (some files OpenMDW-1.1) |
| [GEM-X model weights](https://huggingface.co/nvidia/GEM-X) | NVIDIA Open Model License (commercial use allowed) |
| [SOMA-X](https://huggingface.co/nvidia/SOMA-X) body model and assets | Apache 2.0 |
| YOLOX HumanArt person detector (OpenMMLab) | Apache 2.0 |
| PyTorch | BSD-3-Clause |
| ffmpeg (via winget) | LGPL / GPL, depending on the build |
| Python | PSF License |

No SMPL/SMPL-X (non-commercial) files are used anywhere. Details: [capture/README.md](capture/README.md#licences).

## MIT licence text (applies to the MIT components above)
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
