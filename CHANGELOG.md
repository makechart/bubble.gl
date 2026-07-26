# Change Logs

## v0.0.2

 - fix tooltip hover offset: map mouse into world coordinate by canvas rect ratio
   ( root padding / css transform make display size != world size ); position tooltip by root rect
 - transparent background support: context alpha + premultiplied clear;
   parseColor accepts #rrggbbaa / rgba() / transparent
 - preserveDrawingBuffer: true so export ( e.g. png ) can read canvas anytime
 - default background changed to white ( #ffffff )

## v0.0.1

 - initial release: GPGPU force layout bubble chart
   - fully GPU-side simulation ( density field repulsion + position/velocity texture ping-pong ),
     zero per-frame CPU-GPU transfer; handles 100k+ points
   - dimension: name / category / size
   - config: palette, background, bubble padding, anchor layout ( orbit / circular / array / center )
   - interaction: hover tooltip ( ID buffer picking ), press-and-hold mouse repulsor
