// @makechart/bubble.gl - GPGPU force layout bubble chart
// 100k+ 點的 force layout。sim 全在 GPU：
//   pass 1 (splat): 所有點 additive blend 進低解析度 density texture
//   pass 2 (update): position/velocity texture ping-pong, repulsion = -∇density
//   pass 3 (draw): gl_VertexID -> texelFetch position
// 互動: hover tooltip ( ID buffer picking ), 按住滑鼠 = 斥力點
var mod;
module.exports = {
  pkg: {
    name: '@makechart/bubble.gl', version: '0.0.2',
    syncInit: true,
    extend: {ns: 'local', name: 'echarts', path: 'common', version: 'main'},
    dependencies: [
      {name: "ldcolor"}
    ]
  },
  init: function(o) {
    o.pubsub.fire('init', {mod: mod({ctx: o.ctx, root: o.root, t: o.t}), prepareSvg: false});
  }
};

mod = function(o) {
  var ldcolor = o.ctx.ldcolor, root = o.root;
  var TW = 512, MAXK = 16, DW = 320, DH = 180;

  var VS_SPLAT = [
    '#version 300 es',
    'uniform sampler2D u_pos;',
    'uniform sampler2D u_attr;',
    'uniform vec2 u_world;',
    'uniform float u_scale;',
    'uniform float u_pad;',
    'out float v_r;',
    'void main() {',
    '  ivec2 tc = ivec2(gl_VertexID % 512, gl_VertexID / 512);',
    '  vec4 pv = texelFetch(u_pos, tc, 0);',
    '  v_r = texelFetch(u_attr, tc, 0).r;',
    '  vec2 clip = (pv.xy / u_world) * 2.0 - 1.0;',
    '  gl_Position = vec4(clip, 0.0, 1.0);',
    '  gl_PointSize = max(2.0, (v_r + u_pad) * 2.0 * u_scale);',
    '}'
  ].join('\n');

  var FS_SPLAT = [
    '#version 300 es',
    'precision mediump float;',
    'in float v_r;',
    'out vec4 o;',
    'void main() {',
    '  vec2 uv = gl_PointCoord - 0.5;',
    '  float k = max(0.0, 1.0 - dot(uv, uv) * 4.0);',
    '  o = vec4(v_r * 0.3 * k * k, 0.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  var VS_QUAD = [
    '#version 300 es',
    'void main() {',
    '  vec2 v = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);',
    '  gl_Position = vec4(v, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FS_UPDATE = [
    '#version 300 es',
    'precision highp float;',
    'uniform sampler2D u_pos;',
    'uniform sampler2D u_attr;',
    'uniform sampler2D u_density;',
    'uniform vec2 u_world;',
    'uniform vec2 u_centers[16];',
    'uniform float u_repel;',
    'uniform vec3 u_mouse;',
    'uniform int u_n;',
    'out vec4 outPV;',
    'void main() {',
    '  ivec2 tc = ivec2(gl_FragCoord.xy);',
    '  int id = tc.y * 512 + tc.x;',
    '  vec4 pv = texelFetch(u_pos, tc, 0);',
    '  if(id >= u_n) { outPV = pv; return; }',
    '  vec2 p = pv.xy, v = pv.zw;',
    '  int k = int(texelFetch(u_attr, tc, 0).g);',
    '  vec2 f = (u_centers[k] - p) * 0.004;',
    '  vec2 uv = p / u_world;',
    '  vec2 e = vec2(1.5 / 320.0, 1.5 / 180.0);',
    '  float dr = texture(u_density, uv + vec2(e.x, 0.0)).r;',
    '  float dl = texture(u_density, uv - vec2(e.x, 0.0)).r;',
    '  float du = texture(u_density, uv + vec2(0.0, e.y)).r;',
    '  float dd = texture(u_density, uv - vec2(0.0, e.y)).r;',
    '  f -= vec2(dr - dl, du - dd) * u_repel;',
    '  vec2 dm = p - u_mouse.xy;',
    '  float md2 = dot(dm, dm);',
    '  if(u_mouse.z > 0.5 && md2 < 22500.0) {',
    '    float md = sqrt(md2) + 0.001;',
    '    f += dm / md * (1.0 - md / 150.0) * 3.0;',
    '  }',
    '  if(p.x < 10.0) f.x += (10.0 - p.x) * 0.02;',
    '  else if(p.x > u_world.x - 10.0) f.x -= (p.x - u_world.x + 10.0) * 0.02;',
    '  if(p.y < 10.0) f.y += (10.0 - p.y) * 0.02;',
    '  else if(p.y > u_world.y - 10.0) f.y -= (p.y - u_world.y + 10.0) * 0.02;',
    '  v = (v + f) * 0.9;',
    '  float sp2 = dot(v, v);',
    '  if(sp2 > 36.0) v *= 6.0 / sqrt(sp2);',
    '  outPV = vec4(p + v, v);',
    '}'
  ].join('\n');

  var VS_DRAW = [
    '#version 300 es',
    'in float a_radius;',
    'in vec3 a_color;',
    'uniform sampler2D u_pos;',
    'uniform vec2 u_world;',
    'uniform float u_dpr;',
    'out vec3 v_color;',
    'void main() {',
    '  ivec2 tc = ivec2(gl_VertexID % 512, gl_VertexID / 512);',
    '  vec4 pv = texelFetch(u_pos, tc, 0);',
    '  vec2 clip = (pv.xy / u_world) * 2.0 - 1.0;',
    '  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);',
    '  gl_PointSize = a_radius * 2.0 * u_dpr;',
    '  v_color = a_color;',
    '}'
  ].join('\n');

  var FS_DRAW = [
    '#version 300 es',
    'precision mediump float;',
    'in vec3 v_color;',
    'out vec4 outColor;',
    'void main() {',
    '  vec2 uv = gl_PointCoord - 0.5;',
    '  float d2 = dot(uv, uv);',
    '  if(d2 > 0.25) discard;',
    '  float alpha = smoothstep(0.25, 0.16, d2);',
    '  outColor = vec4(v_color * alpha, alpha);',
    '}'
  ].join('\n');

  var VS_PICK = [
    '#version 300 es',
    'in float a_radius;',
    'uniform sampler2D u_pos;',
    'uniform vec2 u_world;',
    'uniform float u_dpr;',
    'out vec4 v_id;',
    'void main() {',
    '  ivec2 tc = ivec2(gl_VertexID % 512, gl_VertexID / 512);',
    '  vec4 pv = texelFetch(u_pos, tc, 0);',
    '  vec2 clip = (pv.xy / u_world) * 2.0 - 1.0;',
    '  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);',
    '  gl_PointSize = max(4.0, a_radius * 2.0 * u_dpr);',
    '  int id = gl_VertexID + 1;',
    '  v_id = vec4(float(id % 256), float((id / 256) % 256), float(id / 65536), 255.0) / 255.0;',
    '}'
  ].join('\n');

  var FS_PICK = [
    '#version 300 es',
    'precision mediump float;',
    'in vec4 v_id;',
    'out vec4 o;',
    'void main() {',
    '  vec2 uv = gl_PointCoord - 0.5;',
    '  if(dot(uv, uv) > 0.25) discard;',
    '  o = v_id;',
    '}'
  ].join('\n');

  function hsl2rgb(h, s, l) {
    h = ((h % 1) + 1) % 1;
    var f = function(n) {
      var k = (n + h * 12) % 12;
      var a = s * Math.min(l, 1 - l);
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4)];
  }

  // 回傳 [r,g,b,a] ( 0~1 ); 支援 #rrggbb / #rrggbbaa / rgb() / rgba() / transparent
  function parseWeb(c) {
    if(typeof(c) != 'string') { return null; }
    if(c == 'transparent') { return [0, 0, 0, 0]; }
    var re = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?/i.exec(c);
    if(re) {
      return [
        parseInt(re[1], 16) / 255, parseInt(re[2], 16) / 255, parseInt(re[3], 16) / 255,
        re[4] != null ? parseInt(re[4], 16) / 255 : 1
      ];
    }
    re = /^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)([,\s/]+([\d.]+%?))?/.exec(c);
    if(re) {
      var a = 1;
      if(re[5] != null) { a = /%$/.test(re[5]) ? parseFloat(re[5]) / 100 : parseFloat(re[5]); }
      return [+re[1] / 255, +re[2] / 255, +re[3] / 255, a];
    }
    return null;
  }
  function parseColor(c) {
    if(!c) { return null; }
    var p = parseWeb(c);
    if(!p && typeof(ldcolor) != 'undefined' && ldcolor.web) { p = parseWeb(ldcolor.web(c)); }
    return p;
  }

  // 內部狀態 ( closure, 不放 chart context )
  var dpr = window.devicePixelRatio || 1;
  var bg = [1, 1, 1, 1];   // 背景色 rgba ( config: background, a=0 為透明 )
  var pad = 8;                       // bubble 間距 ( config: bubble.padding )
  var anchorMode = 'orbit';          // 群心佈局 ( config: dynamics.anchor )
  var canvas = null, tip = null, gl = null;
  var progs = {};
  var fixed = {};      // dataset 無關資源: density texture / pick buffer / vaoEmpty
  var ds = null;       // dataset 相關資源
  var parsed = null;   // parse 後的 {names, cats, sizes, catNames}
  var dirty = false;
  var Wc = 0, Hc = 0, tsim = 0, rafId = null, lastPick = 0;
  var mouse = {x: -9999, y: -9999, down: false, over: false};
  var destroyed = false;

  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { throw new Error(gl.getShaderInfoLog(sh)); }
    return sh;
  }
  function makeProg(vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'a_radius');
    gl.bindAttribLocation(p, 1, 'a_color');
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p, gl.LINK_STATUS)) { throw new Error(gl.getProgramInfoLog(p)); }
    return p;
  }
  function makeTex(w, h, ifmt, data, filter) {
    var tx = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.texStorage2D(gl.TEXTURE_2D, 1, ifmt, w, h);
    if(data) { gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, data); }
    var ft = filter || gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, ft);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, ft);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tx;
  }
  function makeFbo(tx) {
    var f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tx, 0);
    return f;
  }
  function uni(p, n) { return gl.getUniformLocation(p, n); }

  function disposeDs() {
    if(!ds) { return; }
    gl.deleteTexture(ds.texPos[0]);
    gl.deleteTexture(ds.texPos[1]);
    gl.deleteTexture(ds.texAttr);
    gl.deleteFramebuffer(ds.fboPos[0]);
    gl.deleteFramebuffer(ds.fboPos[1]);
    gl.deleteBuffer(ds.radBuf);
    gl.deleteBuffer(ds.colBuf);
    gl.deleteVertexArray(ds.vao);
    ds = null;
  }

  // 由 parsed + catColors ( 每 category 一個 [r,g,b] ) 建 dataset GPU 資源
  function build(catColors) {
    disposeDs();
    if(!parsed || !parsed.sizes.length) { return; }
    var n = parsed.sizes.length;
    var kCount = Math.min(parsed.catNames.length, MAXK);
    var th = Math.ceil(n / TW);
    var sum = 0, i;
    for(i = 0; i < n; i++) { sum += parsed.sizes[i]; }
    var kr = Math.sqrt(Wc * Hc * 0.35 / (Math.PI * (sum || 1)));
    var posvel = new Float32Array(TW * th * 4);
    var attr = new Float32Array(TW * th * 4);
    var radii = new Float32Array(n);
    var colors = new Float32Array(n * 3);
    for(i = 0; i < n; i++) {
      posvel[i * 4] = Math.random() * Wc;
      posvel[i * 4 + 1] = Math.random() * Hc;
      var r = Math.min(20, Math.max(0.7, Math.sqrt(parsed.sizes[i]) * kr));
      var ki = parsed.cats[i] % MAXK;
      attr[i * 4] = r;
      attr[i * 4 + 1] = ki;
      radii[i] = r;
      var c = (catColors && catColors[ki]) || hsl2rgb(ki / (kCount || 1), 0.7, 0.6);
      colors[i * 3] = c[0];
      colors[i * 3 + 1] = c[1];
      colors[i * 3 + 2] = c[2];
    }
    var texPos = [makeTex(TW, th, gl.RGBA32F, posvel), makeTex(TW, th, gl.RGBA32F, null)];
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var radBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, radBuf);
    gl.bufferData(gl.ARRAY_BUFFER, radii, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 1, gl.FLOAT, false, 0, 0);
    var colBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    ds = {
      n: n, th: th, vao: vao, radBuf: radBuf, colBuf: colBuf, texPos: texPos,
      texAttr: makeTex(TW, th, gl.RGBA32F, attr),
      fboPos: [makeFbo(texPos[0]), makeFbo(texPos[1])],
      kCount: kCount, centers: new Float32Array(MAXK * 2), cur: 0
    };
  }

  function setWorldUnis() {
    var name, p, u;
    for(name in progs) {
      p = progs[name];
      gl.useProgram(p);
      u = uni(p, 'u_world');
      if(u) { gl.uniform2f(u, Wc, Hc); }
    }
    gl.useProgram(progs.splat);
    gl.uniform1f(uni(progs.splat, 'u_scale'), DW / Wc);
    gl.useProgram(progs.draw);
    gl.uniform1f(uni(progs.draw, 'u_dpr'), dpr);
    gl.useProgram(progs.pick);
    gl.uniform1f(uni(progs.pick, 'u_dpr'), dpr);
    // pick buffer 尺寸跟 canvas 綁定, resize 時重建
    if(fixed.texPick) { gl.deleteTexture(fixed.texPick); }
    if(fixed.fboPick) { gl.deleteFramebuffer(fixed.fboPick); }
    var tx = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, canvas.width, canvas.height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    fixed.texPick = tx;
    fixed.fboPick = makeFbo(tx);
  }

  // 依 anchor 設定計算各 category 的群心 ( array 演算法參考 @makechart/bubble )
  function updateCenters() {
    var K = ds.kCount, rr = Math.min(Wc, Hc) * 0.28, k, a;
    if(anchorMode == 'center') {
      for(k = 0; k < K; k++) {
        ds.centers[k * 2] = Wc / 2;
        ds.centers[k * 2 + 1] = Hc / 2;
      }
    } else if(anchorMode == 'array') {
      var cols = Math.max(1, Math.ceil(Math.sqrt(K * Wc / Hc)));
      var rows = Math.max(1, Math.ceil(K / cols));
      var cw = Wc / cols, ch = Hc / rows;
      for(k = 0; k < K; k++) {
        ds.centers[k * 2] = ((k % cols) + 0.5) * cw;
        ds.centers[k * 2 + 1] = (Math.floor(k / cols) + 0.5) * ch;
      }
    } else {
      // orbit ( 緩慢繞行 ) 或 circular ( 靜態圓 )
      var spin = (anchorMode == 'orbit') ? tsim * 0.15 : 0;
      for(k = 0; k < K; k++) {
        a = spin + k * Math.PI * 2 / K;
        ds.centers[k * 2] = Wc / 2 + Math.cos(a) * rr;
        ds.centers[k * 2 + 1] = Hc / 2 + Math.sin(a) * rr * 0.8;
      }
    }
  }

  function step() {
    if(!ds) { return; }
    tsim += 1 / 60;
    updateCenters();

    gl.bindFramebuffer(gl.FRAMEBUFFER, fixed.fboDen);
    gl.viewport(0, 0, DW, DH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(progs.splat);
    gl.bindVertexArray(fixed.vaoEmpty);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ds.texPos[ds.cur]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, ds.texAttr);
    gl.drawArrays(gl.POINTS, 0, ds.n);

    gl.bindFramebuffer(gl.FRAMEBUFFER, ds.fboPos[1 - ds.cur]);
    gl.viewport(0, 0, TW, ds.th);
    gl.disable(gl.BLEND);
    gl.useProgram(progs.update);
    gl.uniform2fv(uni(progs.update, 'u_centers'), ds.centers);
    gl.uniform1i(uni(progs.update, 'u_n'), ds.n);
    gl.uniform3f(uni(progs.update, 'u_mouse'), mouse.x, mouse.y, (mouse.down && mouse.over) ? 1 : 0);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, fixed.texDen);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    ds.cur = 1 - ds.cur;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    // canvas 為 premultiplied alpha, clear color 也要 premultiply
    gl.clearColor(bg[0] * bg[3], bg[1] * bg[3], bg[2] * bg[3], bg[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(progs.draw);
    gl.bindVertexArray(ds.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ds.texPos[ds.cur]);
    gl.drawArrays(gl.POINTS, 0, ds.n);
  }

  function loopFn() {
    if(destroyed) { return; }
    step();
    rafId = requestAnimationFrame(loopFn);
  }

  function doPick(mx, my) {
    if(!ds) { return -1; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fixed.fboPick);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(progs.pick);
    gl.bindVertexArray(ds.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ds.texPos[ds.cur]);
    gl.drawArrays(gl.POINTS, 0, ds.n);
    var px8 = new Uint8Array(4);
    gl.readPixels(
      Math.min(canvas.width - 1, Math.max(0, Math.round(mx * dpr))),
      Math.min(canvas.height - 1, Math.max(0, Math.round(canvas.height - 1 - my * dpr))),
      1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px8
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return px8[0] + px8[1] * 256 + px8[2] * 65536 - 1;
  }

  function onMove(e) {
    // 世界座標 != canvas 顯示座標 ( root 可能有 padding, 或整體被 CSS transform 縮放 ),
    // 以 rect 比例換算; tooltip 定位在 root 座標系, 用 root rect 換算
    var rect = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - rect.left) * (Wc / (rect.width || Wc));
    mouse.y = (e.clientY - rect.top) * (Hc / (rect.height || Hc));
    mouse.over = true;
    if(mouse.down || !parsed) { tip.style.display = 'none'; return; }
    var now = performance.now();
    if(now - lastPick < 50) { return; }
    lastPick = now;
    var id = doPick(mouse.x, mouse.y);
    if(id >= 0 && id < parsed.names.length) {
      var rrect = root.getBoundingClientRect();
      tip.textContent = parsed.names[id] + '\ncategory: ' +
        parsed.catNames[parsed.cats[id]] + '\nsize: ' + parsed.sizes[id];
      tip.style.left = (e.clientX - rrect.left + 14) + 'px';
      tip.style.top = (e.clientY - rrect.top + 14) + 'px';
      tip.style.display = 'block';
    } else {
      tip.style.display = 'none';
    }
  }

  return {
    sample: function() {
      var cats = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
      var raw = [], i;
      for(i = 0; i < 3000; i++) {
        raw.push({
          name: 'item-' + i,
          category: cats[Math.floor(Math.random() * cats.length)],
          size: +(1 + Math.random() * 99).toFixed(1)
        });
      }
      return {
        raw: raw,
        binding: {
          name: {key: 'name'},
          category: {key: 'category'},
          size: {key: 'size'}
        }
      };
    },
    config: {
      palette: {type: 'palette'},
      background: {type: 'color', default: '#ffffff'},
      bubble: {
        padding: {name: "bubble padding", type: 'number', default: 8, min: 0, max: 40, step: 1}
      },
      dynamics: {
        anchor: {
          name: "Anchor Layout", type: 'choice', default: 'orbit',
          values: [
            {name: "Orbit", value: 'orbit'},
            {name: "Circular", value: 'circular'},
            {name: "Array", value: 'array'},
            {name: "Center", value: 'center'}
          ]
        }
      }
    },
    dimension: {
      size: {type: 'R', name: "size", priority: 1},
      category: {type: 'C', name: "category", priority: 2},
      name: {type: 'NC', name: "name", priority: 3}
    },
    init: function() {
      if(getComputedStyle(root).position == 'static') { root.style.position = 'relative'; }
      canvas = document.createElement('canvas');
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      root.appendChild(canvas);
      tip = document.createElement('div');
      tip.style.cssText = [
        'position:absolute', 'display:none', 'padding:6px 10px', 'pointer-events:none',
        'background:rgba(24,30,40,0.92)', 'border:1px solid #3a4a5e', 'border-radius:4px',
        'font:12px/1.5 monospace', 'color:#dfe8f2', 'white-space:pre', 'z-index:10'
      ].join(';');
      root.appendChild(tip);
      // alpha: 支援透明背景; preserveDrawingBuffer: 讓 toDataURL/toBlob 匯出可隨時讀取
      gl = canvas.getContext('webgl2', {antialias: false, alpha: true, preserveDrawingBuffer: true});
      if(!gl) { throw new Error("bubble.gl: WebGL2 not supported"); }
      if(!gl.getExtension('EXT_color_buffer_float')) {
        throw new Error("bubble.gl: EXT_color_buffer_float not supported");
      }
      progs.splat = makeProg(VS_SPLAT, FS_SPLAT);
      progs.update = makeProg(VS_QUAD, FS_UPDATE);
      progs.draw = makeProg(VS_DRAW, FS_DRAW);
      progs.pick = makeProg(VS_PICK, FS_PICK);
      gl.useProgram(progs.splat);
      gl.uniform1i(uni(progs.splat, 'u_pos'), 0);
      gl.uniform1i(uni(progs.splat, 'u_attr'), 1);
      gl.uniform1f(uni(progs.splat, 'u_pad'), pad);
      gl.useProgram(progs.update);
      gl.uniform1i(uni(progs.update, 'u_pos'), 0);
      gl.uniform1i(uni(progs.update, 'u_attr'), 1);
      gl.uniform1i(uni(progs.update, 'u_density'), 2);
      gl.uniform1f(uni(progs.update, 'u_repel'), 0.5);
      gl.useProgram(progs.draw);
      gl.uniform1i(uni(progs.draw, 'u_pos'), 0);
      gl.useProgram(progs.pick);
      gl.uniform1i(uni(progs.pick, 'u_pos'), 0);
      fixed.texDen = makeTex(DW, DH, gl.RGBA16F, null, gl.LINEAR);
      fixed.fboDen = makeFbo(fixed.texDen);
      fixed.vaoEmpty = gl.createVertexArray();
      canvas.addEventListener('mousemove', onMove);
      canvas.addEventListener('mousedown', function() { mouse.down = true; tip.style.display = 'none'; });
      window.addEventListener('mouseup', this._mouseupFn = function() { mouse.down = false; });
      canvas.addEventListener('mouseleave', function() { mouse.over = false; tip.style.display = 'none'; });
      loopFn();
      // 若 race 導致 resize 比 init 先被呼叫過, 這裡補跑一次
      if(dirty && this.mod && this.mod.resize) { this.mod.resize.apply(this); }
    },
    parse: function() {
      var rows = this.data || [];
      var catIndex = new Map();
      var names = [], cats = [], sizes = [], i, row, cat;
      for(i = 0; i < rows.length; i++) {
        row = rows[i];
        cat = String(row.category != null ? row.category : '');
        if(!catIndex.has(cat)) { catIndex.set(cat, catIndex.size); }
        names.push(String(row.name != null ? row.name : ''));
        cats.push(catIndex.get(cat));
        sizes.push(Math.max(0.01, +row.size || 1));
      }
      parsed = {names: names, cats: cats, sizes: sizes, catNames: Array.from(catIndex.keys())};
      dirty = true;
    },
    resize: function() {
      // 防禦: mod.init 前不應被呼叫 ( @plotdb/chart 3.0.1+ 已在 chart 層 gate, 此為保險 )
      if(!gl) { dirty = true; return; }
      var cfg = this.cfg || {};
      var c = cfg.background && parseColor(cfg.background);
      if(c) { bg = c; }
      pad = (cfg.bubble && cfg.bubble.padding != null) ? +cfg.bubble.padding : 8;
      anchorMode = (cfg.dynamics && cfg.dynamics.anchor) || 'orbit';
      gl.useProgram(progs.splat);
      gl.uniform1f(uni(progs.splat, 'u_pad'), pad);
      var w = root.clientWidth || 640;
      var h = root.clientHeight || 480;
      var sizeChanged = (w != Wc || h != Hc);
      if(sizeChanged) {
        Wc = w;
        Hc = h;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        setWorldUnis();
      }
      if(dirty || sizeChanged) {
        var catColors = null;
        if(parsed && this.cfg && this.cfg.palette && this.cfg.palette.colors) {
          var pcs = this.cfg.palette.colors.map(parseColor).filter(function(c) { return c; });
          if(pcs.length) {
            catColors = parsed.catNames.map(function(cn, i) { return pcs[i % pcs.length]; });
          }
        }
        build(catColors);
        dirty = false;
      }
    },
    render: function() {},
    destroy: function() {
      var name;
      destroyed = true;
      if(rafId != null) { cancelAnimationFrame(rafId); }
      if(this._mouseupFn) { window.removeEventListener('mouseup', this._mouseupFn); }
      disposeDs();
      if(gl) {
        for(name in progs) { gl.deleteProgram(progs[name]); }
        if(fixed.texDen) { gl.deleteTexture(fixed.texDen); }
        if(fixed.texPick) { gl.deleteTexture(fixed.texPick); }
        var lose = gl.getExtension('WEBGL_lose_context');
        if(lose) { lose.loseContext(); }
      }
      if(canvas && canvas.parentNode) { canvas.parentNode.removeChild(canvas); }
      if(tip && tip.parentNode) { tip.parentNode.removeChild(tip); }
    }
  };
};
