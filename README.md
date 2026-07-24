# @makechart/bubble.gl

GPGPU force layout bubble chart for [makechart](https://makechart.io) —
WebGL2-based, handles 100k+ data points at 60fps.

Part of the **chartgl** series: charts that run their layout simulation entirely
on the GPU, with zero per-frame CPU-GPU data transfer.


## How it works

Each frame runs 3 render passes, all on GPU:

 1. **splat**: all points are rendered into a low-resolution density texture
    with additive blending — O(N)
 2. **update**: position / velocity are stored in a pair of RGBA32F textures
    ( ping-pong ). repulsion is the gradient of the density field ( `-∇density` ),
    plus per-category anchor attraction — O(N)
 3. **draw**: vertex shader fetches positions via `gl_VertexID` / `texelFetch`,
    radius / color from static VBOs

The CPU only uploads a few uniforms per frame ( anchor centers, mouse ).

Requires WebGL2 with `EXT_color_buffer_float` ( widely available on desktop ).


## Chart interface

Implemented as a `@plotdb/block` block, extending makechart's generic
`@plotdb/chart` adapter.

### dimension

 - `size` ( R ): bubble area. radii are auto-scaled so total area fits the canvas
 - `category` ( C ): color / cluster grouping ( up to 16 categories )
 - `name` ( NC ): label, shown in hover tooltip

### config

 - `palette`: category colors
 - `background`: canvas background color
 - `bubble.padding`: spacing between bubbles ( repulsion kernel radius )
 - `dynamics.anchor`: cluster anchor layout — `orbit` ( slowly rotating, default ),
   `circular`, `array` ( grid ), `center`

### interaction

 - hover: tooltip with name / category / size ( ID-buffer picking, works at any
   point count )
 - press and hold: mouse becomes a repulsor pushing bubbles away


## Development

    npm install
    ./build          # src/index.pug + src/index.js -> dist/index.html

In makechart server, link the local build for development:

    npx fedep -l "@makechart/bubble.gl:<path-to-this-repo>"


## License

MIT
