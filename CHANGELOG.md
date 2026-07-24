# Change Logs

## v0.0.1

 - initial release: GPGPU force layout bubble chart
   - fully GPU-side simulation ( density field repulsion + position/velocity texture ping-pong ),
     zero per-frame CPU-GPU transfer; handles 100k+ points
   - dimension: name / category / size
   - config: palette, background, bubble padding, anchor layout ( orbit / circular / array / center )
   - interaction: hover tooltip ( ID buffer picking ), press-and-hold mouse repulsor
