import { vec3, mat4 } from 'gl-matrix';
import getOptionsURL from './misc/getOptionsURL';
import Enums from './misc/Enums';
import Utils from './misc/Utils';
import SculptManager from './editing/SculptManager';
import Subdivision from './editing/Subdivision';
import Import from './files/Import';
import Gui from './gui/Gui';
import Camera from './math3d/Camera';
import Picking from './math3d/Picking';
import Background from './drawables/Background';
import Mesh from './mesh/Mesh';
import Multimesh from './mesh/multiresolution/Multimesh';
import Primitives from './drawables/Primitives';
import StateManager from './states/StateManager';
import RenderData from './mesh/RenderData';
import Rtt from './drawables/Rtt';
import MeshStatic from './mesh/meshStatic/MeshStatic';
import WebGLCaps from './render/WebGLCaps';
import MeshDynamic from './mesh/dynamic/MeshDynamic';
import { ShaderContour, ShaderMatcap } from './render/shaders';

class Scene {

  protected _gl: WebGLRenderingContext; // webgl context

  protected _cameraSpeed: 0.25;

  // cache canvas stuffs
  protected _pixelRatio: number;
  protected _viewport: HTMLElement;
  protected _canvas: HTMLCanvasElement;
  protected _canvasWidth: number;
  protected _canvasHeight: number;
  protected _canvasOffsetLeft: number;
  protected _canvasOffsetTop: number;

  // core of the app
  protected _stateManager: StateManager; // for undo-redo
  protected _sculptManager: SculptManager;
  protected _camera: Camera;
  protected _picking: Picking; // the ray picking
  protected _pickingSym: Picking; // the symmetrical picking

  // TODO primitive builder
  protected _meshPreview: any;
  protected _torusLength: number;
  protected _torusWidth: number;
  protected _torusRadius: number;
  protected _torusRadial: number;
  protected _torusTubular: number;

  protected _showContour: boolean;
  protected _showGrid: boolean;
  protected _grid: any;
  protected _background: any;
  protected _meshes: Mesh[]; // the meshes
  protected _selectMeshes: Mesh[]; // multi selection
  protected _mesh: Mesh; // the selected mesh

  protected _rttContour: Rtt; // rtt for contour
  protected _rttMerge: Rtt; // rtt decode opaque + merge transparent
  protected _rttOpaque: Rtt; // rtt half float
  protected _rttTransparent: Rtt; // rtt rgbm

  // ui stuffs
  protected _focusGui: boolean; // if the gui is being focused
  protected _gui: Gui;

  protected _preventRender: boolean; // prevent multiple render per frame
  protected _drawFullScene: boolean; // render everything on the rtt
  protected _autoMatrix: boolean; // scale and center the imported meshes
  protected _vertexSRGB: boolean; // srgb vs linear colorspace for vertex color
  protected _action: number;

  constructor() {
    this._gl = null; // webgl context

    this._cameraSpeed = 0.25;

    // cache canvas stuffs
    this._pixelRatio = 1.0;
    this._viewport = document.getElementById('viewport');
    this._canvas = <HTMLCanvasElement>document.getElementById('canvas');
    this._canvasWidth = 0;
    this._canvasHeight = 0;
    this._canvasOffsetLeft = 0;
    this._canvasOffsetTop = 0;

    // core of the app
    this._stateManager = new StateManager(this); // for undo-redo
    this._sculptManager = null;
    this._camera = new Camera(this);
    this._picking = new Picking(this); // the ray picking
    this._pickingSym = new Picking(this, true); // the symmetrical picking

    // TODO primitive builder
    this._meshPreview = null;
    this._torusLength = 0.5;
    this._torusWidth = 0.1;
    this._torusRadius = Math.PI * 2;
    this._torusRadial = 32;
    this._torusTubular = 128;

    // renderable stuffs
    var opts = getOptionsURL();
    this._showContour = opts.outline;
    this._showGrid = opts.grid;
    this._grid = null;
    this._background = null;
    this._meshes = []; // the meshes
    this._selectMeshes = []; // multi selection
    this._mesh = null; // the selected mesh

    this._rttContour = null; // rtt for contour
    this._rttMerge = null; // rtt decode opaque + merge transparent
    this._rttOpaque = null; // rtt half float
    this._rttTransparent = null; // rtt rgbm

    // ui stuffs
    this._focusGui = false; // if the gui is being focused
    this._gui = new Gui(this);

    this._preventRender = false; // prevent multiple render per frame
    this._drawFullScene = false; // render everything on the rtt
    this._autoMatrix = opts.scalecenter; // scale and center the imported meshes
    this._vertexSRGB = true; // srgb vs linear colorspace for vertex color
  }

  start() {
    this.initWebGL();
    if (!this._gl)
      return;

    this._sculptManager = new SculptManager(this);
    this._background = new Background(this._gl, this);

    this._rttContour = new Rtt(this._gl, Enums.Shader.CONTOUR, null);
    this._rttMerge = new Rtt(this._gl, Enums.Shader.MERGE, null);
    this._rttOpaque = new Rtt(this._gl, Enums.Shader.FXAA);
    this._rttTransparent = new Rtt(this._gl, null, this._rttOpaque.getDepth(), true);

    this._grid = Primitives.createGrid(this._gl);
    this.initGrid();

    this.loadTextures();
    this._gui.initGui();
    this.onCanvasResize();

    var modelURL = getOptionsURL().modelurl;
    if (modelURL) this.addModelURL(modelURL);
    // else this.addSphere();
  }

  ////////////////
  // LOAD FILES
  ////////////////
  getFileType(name) {
    var lower = name.toLowerCase();
    if (lower.endsWith('.obj')) return 'obj';
    if (lower.endsWith('.sgl')) return 'sgl';
    if (lower.endsWith('.stl')) return 'stl';
    if (lower.endsWith('.ply')) return 'ply';
    return;
  }


  addModelURL(url) {
    var fileType = this.getFileType(url);
    if (!fileType)
      return;

    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);

    xhr.responseType = fileType === 'obj' ? 'text' : 'arraybuffer';

    xhr.onload = () => {
      if (xhr.status === 200)
        this.loadScene(xhr.response, fileType);
    };

    xhr.send(null);
  }

  getBackground() {
    return this._background;
  }

  getViewport() {
    return this._viewport;
  }

  getCanvas() {
    return this._canvas;
  }

  getPixelRatio() {
    return this._pixelRatio;
  }

  getCanvasWidth() {
    return this._canvasWidth;
  }

  getCanvasHeight() {
    return this._canvasHeight;
  }

  getCamera() {
    return this._camera;
  }

  getGui() {
    return this._gui;
  }

  getMeshes() {
    return this._meshes;
  }

  getMesh() {
    return this._mesh;
  }

  getSelectedMeshes() {
    return this._selectMeshes;
  }

  getPicking() {
    return this._picking;
  }

  getPickingSymmetry() {
    return this._pickingSym;
  }

  getSculptManager() {
    return this._sculptManager;
  }

  getStateManager() {
    return this._stateManager;
  }

  setMesh(mesh) {
    return this.setOrUnsetMesh(mesh);
  }

  setCanvasCursor(style) {
    this._canvas.style.cursor = style;
  }

  initGrid() {
    var grid = this._grid;
    grid.normalizeSize();
    var gridm = grid.getMatrix();
    mat4.translate(gridm, gridm, [0.0, -0.45, 0.0]);
    var scale = 2.5;
    mat4.scale(gridm, gridm, [scale, scale, scale]);
    this._grid.setShaderType(Enums.Shader.FLAT);
    grid.setFlatColor([0.01, 0.01, 0.01]);
  }

  setOrUnsetMesh(mesh, multiSelect = false) {
    if (!mesh) {
      this._selectMeshes.length = 0;
    } else if (!multiSelect) {
      this._selectMeshes.length = 0;
      this._selectMeshes.push(mesh);
    } else {
      var id = this.getIndexSelectMesh(mesh);
      if (id >= 0) {
        if (this._selectMeshes.length > 1) {
          this._selectMeshes.splice(id, 1);
          mesh = this._selectMeshes[0];
        }
      } else {
        this._selectMeshes.push(mesh);
      }
    }

    this._mesh = mesh;
    this.getGui().updateMesh();
    this.render();
    return mesh;
  }

  renderSelectOverRtt() {
    if (this._requestRender())
      this._drawFullScene = false;
  }

  _requestRender() {
    if (this._preventRender === true)
      return false; // render already requested for the next frame

    window.requestAnimationFrame(this.applyRender.bind(this));
    this._preventRender = true;
    return true;
  }

  render() {
    this._drawFullScene = true;
    this._requestRender();
  }

  applyRender() {
    this._preventRender = false;
    this.updateMatricesAndSort();

    var gl = this._gl;
    if (!gl) return;

    if (this._drawFullScene) this._drawScene();

    gl.disable(gl.DEPTH_TEST);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._rttMerge.getFramebuffer());
    this._rttMerge.render(this); // merge + decode

    // render to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this._rttOpaque.render(this); // fxaa

    gl.enable(gl.DEPTH_TEST);

    this._sculptManager.postRender(); // draw sculpting gizmo stuffs
  }

  _drawScene() {
    var gl = this._gl;
    var i = 0;
    var meshes = this._meshes;
    var nbMeshes = meshes.length;

    ///////////////
    // CONTOUR 1/2
    ///////////////
    gl.disable(gl.DEPTH_TEST);

    let showContour = this._selectMeshes.length > 0
      && this._showContour
      && ShaderContour.color[3] > 0.0;

    if (showContour) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._rttContour.getFramebuffer());
      gl.clear(gl.COLOR_BUFFER_BIT);
      for (var s = 0, sel = this._selectMeshes, nbSel = sel.length; s < nbSel; ++s)
        sel[s].renderFlatColor(this);
    }
    gl.enable(gl.DEPTH_TEST);

    ///////////////
    // OPAQUE PASS
    ///////////////
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._rttOpaque.getFramebuffer());
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // grid
    if (this._showGrid) this._grid.render(this);

    // (post opaque pass)
    for (i = 0; i < nbMeshes; ++i) {
      if (meshes[i].isTransparent()) break;
      meshes[i].render(this);
    }
    var startTransparent = i;
    if (this._meshPreview) this._meshPreview.render(this);

    // background
    this._background.render();

    ///////////////
    // TRANSPARENT PASS
    ///////////////
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._rttTransparent.getFramebuffer());
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);

    // wireframe for dynamic mesh has duplicate edges
    gl.depthFunc(gl.LESS);
    for (i = 0; i < nbMeshes; ++i) {
      if (meshes[i].getShowWireframe())
        meshes[i].renderWireframe(this);
    }
    gl.depthFunc(gl.LEQUAL);

    gl.depthMask(false);
    gl.enable(gl.CULL_FACE);

    for (i = startTransparent; i < nbMeshes; ++i) {
      gl.cullFace(gl.FRONT); // draw back first
      meshes[i].render(this);
      gl.cullFace(gl.BACK); // ... and then front
      meshes[i].render(this);
    }

    gl.disable(gl.CULL_FACE);

    ///////////////
    // CONTOUR 2/2
    ///////////////
    if (showContour) {
      this._rttContour.render(this);
    }

    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /** Pre compute matrices and sort meshes */
  updateMatricesAndSort() {
    var meshes = this._meshes;
    var cam = this._camera;
    if (meshes.length > 0) {
      cam.optimizeNearFar(this.computeBoundingBoxScene());
    }

    for (var i = 0, nb = meshes.length; i < nb; ++i) {
      meshes[i].updateMatrices(cam);
    }

    meshes.sort(Mesh.sortFunction);

    if (this._meshPreview) this._meshPreview.updateMatrices(cam);
    if (this._grid) this._grid.updateMatrices(cam);
  }

  initWebGL() {
    var attributes = {
      antialias: false,
      stencil: true
    };

    var canvas = <HTMLCanvasElement>document.getElementById('canvas');

    var gl = this._gl = <WebGLRenderingContext>(canvas.getContext('webgl', attributes)
      || canvas.getContext('experimental-webgl', attributes));

    if (!gl) {
      window.alert('Could not initialise WebGL. No WebGL, no SculptGL. Sorry.');
      return;
    }

    WebGLCaps.initWebGLExtensions(gl);
    if (!WebGLCaps.getWebGLExtension('OES_element_index_uint'))
      RenderData.ONLY_DRAW_ARRAYS = true;

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);

    gl.disable(gl.CULL_FACE);
    gl.frontFace(gl.CCW);
    gl.cullFace(gl.BACK);

    gl.disable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.disable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);

    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  /** Load textures (preload) */
  loadTextures() {
    var self = this;
    var gl = this._gl;

    var loadTex = function (path, idMaterial) {
      var mat = new Image();
      mat.src = path;

      mat.onload = function () {
        ShaderMatcap.createTexture(gl, mat, idMaterial);
        self.render();
      };
    };

    for (var i = 0, mats = ShaderMatcap.matcaps, l = mats.length; i < l; ++i)
      loadTex(mats[i].path, i);

    this.initAlphaTextures();
  }

  initAlphaTextures() {
    Picking.initAlphas().then((alphaNames) => {
      for (let alphaName of alphaNames) {
        var entry = {};
        entry[alphaName] = alphaName;
        this.getGui().addAlphaOptions(entry);
      }
    });
  }

  /** Called when the window is resized */
  onCanvasResize() {
    var viewport = this._viewport;
    var newWidth = viewport.clientWidth * this._pixelRatio;
    var newHeight = viewport.clientHeight * this._pixelRatio;

    this._canvasOffsetLeft = viewport.offsetLeft;
    this._canvasOffsetTop = viewport.offsetTop;
    this._canvasWidth = newWidth;
    this._canvasHeight = newHeight;

    this._canvas.width = newWidth;
    this._canvas.height = newHeight;

    this._gl.viewport(0, 0, newWidth, newHeight);
    this._camera.onResize(newWidth, newHeight);
    this._background.onResize(newWidth, newHeight);

    this._rttContour.onResize(newWidth, newHeight);
    this._rttMerge.onResize(newWidth, newHeight);
    this._rttOpaque.onResize(newWidth, newHeight);
    this._rttTransparent.onResize(newWidth, newHeight);

    this.render();
  }

  computeRadiusFromBoundingBox(box) {
    var dx = box[3] - box[0];
    var dy = box[4] - box[1];
    var dz = box[5] - box[2];
    return 0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  computeBoundingBoxMeshes(meshes) {
    var bound = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (var i = 0, l = meshes.length; i < l; ++i) {
      if (!meshes[i].isVisible()) continue;
      var bi = meshes[i].computeWorldBound();
      if (bi[0] < bound[0]) bound[0] = bi[0];
      if (bi[1] < bound[1]) bound[1] = bi[1];
      if (bi[2] < bound[2]) bound[2] = bi[2];
      if (bi[3] > bound[3]) bound[3] = bi[3];
      if (bi[4] > bound[4]) bound[4] = bi[4];
      if (bi[5] > bound[5]) bound[5] = bi[5];
    }
    return bound;
  }

  computeBoundingBoxScene() {
    var scene = this._meshes.slice();
    scene.push(this._grid);
    this._sculptManager.addSculptToScene(scene);
    return this.computeBoundingBoxMeshes(scene);
  }

  normalizeAndCenterMeshes(meshes) {
    var box = this.computeBoundingBoxMeshes(meshes);
    var scale = Utils.SCALE / vec3.dist([box[0], box[1], box[2]], [box[3], box[4], box[5]]);

    var mCen = mat4.create();
    mat4.scale(mCen, mCen, [scale, scale, scale]);
    mat4.translate(
      mCen,
      mCen,
      [-(box[0] + box[3]) * 0.5, -(box[1] + box[4]) * 0.5, -(box[2] + box[5]) * 0.5]
    );

    for (var i = 0, l = meshes.length; i < l; ++i) {
      var mat = meshes[i].getMatrix();
      mat4.mul(mat, mCen, mat);
    }
  }

  addSphere() {
    // make a cube and subdivide it
    var mesh = new Multimesh(Primitives.createCube(this._gl));
    mesh.normalizeSize();
    this.subdivideClamp(mesh);
    return this.addNewMesh(mesh);
  }

  addCube() {
    var mesh = new Multimesh(Primitives.createCube(this._gl));
    mesh.normalizeSize();
    mat4.scale(mesh.getMatrix(), mesh.getMatrix(), [0.7, 0.7, 0.7]);
    this.subdivideClamp(mesh, true);
    return this.addNewMesh(mesh);
  }

  addCylinder() {
    var mesh = new Multimesh(Primitives.createCylinder(this._gl));
    mesh.normalizeSize();
    mat4.scale(mesh.getMatrix(), mesh.getMatrix(), [0.7, 0.7, 0.7]);
    this.subdivideClamp(mesh);
    return this.addNewMesh(mesh);
  }

  addTorus(preview) {
    var mesh = new Multimesh(
      Primitives.createTorus(
        this._gl,
        this._torusLength,
        this._torusWidth,
        this._torusRadius,
        this._torusRadial,
        this._torusTubular)
    );
    if (preview) {
      mesh.setShowWireframe(true);
      var scale = 0.3 * Utils.SCALE;
      mat4.scale(mesh.getMatrix(), mesh.getMatrix(), [scale, scale, scale]);
      this._meshPreview = mesh;
      return;
    }
    mesh.normalizeSize();
    this.subdivideClamp(mesh);
    this.addNewMesh(mesh);
  }

  subdivideClamp(mesh, linear = false) {
    Subdivision.LINEAR = !!linear;
    while (mesh.getNbFaces() < 50000)
      mesh.addLevel();
    // keep at max 4 multires
    mesh._meshes.splice(0, Math.min(mesh._meshes.length - 4, 4));
    mesh._sel = mesh._meshes.length - 1;
    Subdivision.LINEAR = false;
  }

  addNewMesh(mesh) {
    this._meshes.push(mesh);
    this._stateManager.pushStateAdd(mesh);
    this.setMesh(mesh);
    return mesh;
  }

  loadScene(fileData, fileType) {
    var newMeshes;
    if (fileType === 'obj') newMeshes = Import.importOBJ(fileData, this._gl);
    else if (fileType === 'sgl') newMeshes = Import.importSGL(fileData, this._gl, this);
    else if (fileType === 'stl') newMeshes = Import.importSTL(fileData, this._gl);
    else if (fileType === 'ply') newMeshes = Import.importPLY(fileData, this._gl);

    var nbNewMeshes = newMeshes.length;
    if (nbNewMeshes === 0) {
      return;
    }

    var meshes = this._meshes;
    for (var i = 0; i < nbNewMeshes; ++i) {
      var mesh = newMeshes[i] = new Multimesh(newMeshes[i]);

      if (!this._vertexSRGB && mesh.getColors()) {
        Utils.convertArrayVec3toSRGB(mesh.getColors());
      }

      mesh.init();
      mesh.initRender();
      meshes.push(mesh);
    }

    if (this._autoMatrix) {
      this.normalizeAndCenterMeshes(newMeshes);
    }

    this._stateManager.pushStateAdd(newMeshes);
    this.setMesh(meshes[meshes.length - 1]);
    this.resetCameraMeshes(newMeshes);
    return newMeshes;
  }

  resetCameraMeshes(meshes = null) {
    if (!meshes) meshes = this._meshes;

    if (meshes.length > 0) {
      var pivot: vec3 = [0.0, 0.0, 0.0];
      var box = this.computeBoundingBoxMeshes(meshes);
      var zoom = 0.8 * this.computeRadiusFromBoundingBox(box);
      zoom *= this._camera.computeFrustumFit();
      vec3.set(pivot, (box[0] + box[3]) * 0.5, (box[1] + box[4]) * 0.5, (box[2] + box[5]) * 0.5);
      this._camera.setAndFocusOnPivot(pivot, zoom);
    } else {
      this._camera.resetView();
    }

    this.render();
  }

  clearScene() {
    this.getStateManager().reset();
    this.getMeshes().length = 0;
    this.getCamera().resetView();
    this.setMesh(null);
    this._action = Enums.Action.NOTHING;
  }

  deleteCurrentSelection() {
    if (!this._mesh)
      return;

    this.removeMeshes(this._selectMeshes);
    this._stateManager.pushStateRemove(this._selectMeshes.slice());
    this._selectMeshes.length = 0;
    this.setMesh(null);
  }

  removeMeshes(rm) {
    var meshes = this._meshes;
    for (var i = 0; i < rm.length; ++i)
      meshes.splice(this.getIndexMesh(rm[i]), 1);
  }

  getIndexMesh(mesh, select = false) {
    var meshes = select ? this._selectMeshes : this._meshes;
    var id = mesh.getID();
    for (var i = 0, nbMeshes = meshes.length; i < nbMeshes; ++i) {
      var testMesh = meshes[i];
      if (testMesh === mesh || testMesh.getID() === id)
        return i;
    }
    return -1;
  }

  getIndexSelectMesh(mesh) {
    return this.getIndexMesh(mesh, true);
  }

  /** Replace a mesh in the scene */
  replaceMesh(mesh, newMesh) {
    var index = this.getIndexMesh(mesh);
    if (index >= 0) this._meshes[index] = newMesh;
    if (this._mesh === mesh) this.setMesh(newMesh);
  }

  duplicateSelection() {
    var meshes = this._selectMeshes.slice();
    var mesh = null;
    for (var i = 0; i < meshes.length; ++i) {
      mesh = meshes[i];
      var copy = new MeshStatic(mesh.getGL());
      copy.copyData(mesh);

      this.addNewMesh(copy);
    }

    this.setMesh(mesh);
  }
}

export default Scene;
