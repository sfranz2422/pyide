# Bundled assets

## Sprites

The sprites in `images/` come from the KAPLAY game library (formerly Kaboom.js),
which is distributed under the MIT License. MIT permits use, copying and
redistribution provided the license notice travels with the work, which is why
the full notice is reproduced below.

`dino_0` through `dino_8` are the nine frames of the original `dino.png` walk
cycle, sliced apart by `tools/build_assets.py` so each frame can be used as its
own Actor image. `dino` is frame 0.

Project: https://github.com/kaplayjs/kaplay

```
MIT License

Copyright (c) 2025 KAPLAY Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Sounds

`sounds/` is empty in this repository. Drop `.wav` or `.ogg` files in the source
folder and re-run:

```
python tools/build_assets.py "path/to/sprites" "path/to/sounds"
```

They will appear in the editor's Sprites panel and become available to student
code as `sounds.<filename>.play()`.

Record the license of whatever you add here, the same way the sprites are
recorded above.
