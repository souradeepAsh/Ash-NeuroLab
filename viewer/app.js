import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { matchesNeuron, selectEdges } from './graph.js';

const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString();
const palette = ['#67e8c5','#71b8ff','#f1b46a','#b59aff','#ed85b6','#ffe393','#74cbdc','#a8de80','#e99285','#b8c4df'];
const stage = $('viewport'), status = $('status');
let manifest, neurons, overview, positions, scene, camera, renderer, controls, dots, lines, halo, partners, pointTexture;
let currentView="front", currentEdges=[];
let visibleIndices = [], selected = -1, selectedEdges = null, selectionEpoch = 0, dirty = true, active = true, stopped = false;
let frame, resizeObserver, intersectionObserver;
const cache = new Map(), controller = new AbortController();
const filter = () => ({classIndex:$('class').value, side:$('side').value});
function message(text, error=false) { status.textContent=text; status.classList.toggle('error',error); }
async function get(path) {
  const r=await fetch(new URL(path,import.meta.url),{signal:controller.signal});
  if(!r.ok) throw new Error(`Could not load ${path} (${r.status}). Reload to retry.`);
  return r;
}
async function compressed(name, json=false) {
  if(!('DecompressionStream' in window)) throw new Error('This browser cannot decompress the dataset. Please use a current Safari, Chrome, Edge or Firefox.');
  const r=await get(`data/${name}`), bytes=await r.arrayBuffer();
  const expected=manifest.files[name];
  const decodedByServer = /(?:^|,)\s*gzip\s*(?:,|$)/i.test(r.headers.get('Content-Encoding') || '');
  if(expected && bytes.byteLength!==(decodedByServer ? expected.rawBytes : expected.bytes)) throw new Error(`Incomplete dataset file: ${name}. Reload to retry.`);
  const body=new Blob([bytes]).stream();
  const stream=decodedByServer ? body : body.pipeThrough(new DecompressionStream('gzip'));
  const result=new Response(stream);
  return json ? result.json() : new Uint32Array(await result.arrayBuffer());
}
function makeScene(){
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));
  stage.append(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();message('The graphics context was lost. Reload this project to restore the brain viewer.',true);stopped=true;});
  scene=new THREE.Scene(); camera=new THREE.PerspectiveCamera(40,1,.1,5000);
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.08;controls.minDistance=15;controls.maxDistance=4000;controls.autoRotateSpeed=.45;
  controls.addEventListener('change',()=>dirty=true);
  const sprite=document.createElement('canvas');sprite.width=sprite.height=32;const ctx=sprite.getContext('2d');ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(16,16,13,0,Math.PI*2);ctx.fill();pointTexture=new THREE.CanvasTexture(sprite);
  dots=new THREE.Points(new THREE.BufferGeometry(),new THREE.PointsMaterial({size:1.4,map:pointTexture,alphaTest:.2,vertexColors:true,transparent:true,opacity:.85,sizeAttenuation:true,depthWrite:false}));
  scene.add(dots);
  partners=new THREE.Points(new THREE.BufferGeometry(),new THREE.PointsMaterial({size:2.6,map:pointTexture,alphaTest:.2,color:'#ffc77d',depthWrite:false}));scene.add(partners);
  lines=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.25,depthWrite:false}));scene.add(lines);
  halo=new THREE.Mesh(new THREE.SphereGeometry(1.7,16,12),new THREE.MeshBasicMaterial({color:'#ffffff',depthTest:false}));halo.visible=false;scene.add(halo);
  resizeObserver=new ResizeObserver(()=>{const {width,height}=stage.getBoundingClientRect();if(width&&height){renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();if(selected<0)view(currentView);dirty=true;}});resizeObserver.observe(stage);
  intersectionObserver=new IntersectionObserver(entries=>{active=entries[0].isIntersecting;dirty=true;});intersectionObserver.observe(stage);
  let down;
  stage.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);
  stage.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;down=null;
    const b=renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();ray.params.Points.threshold=1.8;
    ray.setFromCamera(new THREE.Vector2((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1),camera);
    const hits=ray.intersectObject(dots);if(hits.length)inspect(visibleIndices[hits[0].index]);
  });
  function animate(){if(stopped)return;frame=requestAnimationFrame(animate);if(document.hidden||!active)return;controls.update();if(dirty||controls.autoRotate){renderer.render(scene,camera);dirty=false;}}
  animate(); view('front');
}
function fitPoints(indices,which=currentView){
  if(!indices.length)return;
  const box=new THREE.Box3();for(const i of indices)box.expandByPoint(new THREE.Vector3().fromArray(positions,i*3));
  const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
  const {width,height}=stage.getBoundingClientRect(),aspect=Math.max(.25,width/Math.max(1,height));
  camera.aspect=aspect;camera.updateProjectionMatrix();
  const dimensions=which==='side'?[size.z,size.y,size.x]:which==='top'?[size.x,size.z,size.y]:[size.x,size.y,size.z];
  const distance=Math.max(40,Math.max(dimensions[1],dimensions[0]/aspect)/(2*Math.tan(THREE.MathUtils.degToRad(20)))*1.2+dimensions[2]/2);
  controls.target.copy(center);camera.up.set(0,1,0);camera.position.copy(center);
  if(which==='top'){camera.position.y+=distance;camera.up.set(0,0,-1);}else if(which==='side')camera.position.x+=distance;else camera.position.z+=distance;
  controls.update();dirty=true;
}
function view(which){currentView=which;fitPoints(visibleIndices,which);$('view-label').textContent=`${which.toUpperCase()} VIEW`;document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===which)));}
function fitSelection(){fitPoints([...new Set([selected,...currentEdges.filter((_,i)=>i%3===1)])].filter(i=>i>=0));}
function rebuildDots(){
  const f=filter();visibleIndices=[];const p=[],c=[];const colours=palette.map(v=>new THREE.Color(v));
  const byNt=$('colour').value==='nt';
  neurons.forEach((n,i)=>{if(!matchesNeuron(n,f))return;visibleIndices.push(i);p.push(...positions.subarray(i*3,i*3+3));const col=colours[(byNt?n[6]:n[4])%colours.length];c.push(col.r,col.g,col.b);});
  dots.geometry.dispose();dots.geometry=new THREE.BufferGeometry();dots.geometry.setAttribute('position',new THREE.Float32BufferAttribute(p,3));dots.geometry.setAttribute('color',new THREE.Float32BufferAttribute(c,3));dots.geometry.computeBoundingSphere();
  $('visible-count').textContent=`${fmt(visibleIndices.length)} / ${fmt(neurons.length)} neurons`;
  $('legend').replaceChildren();(byNt?manifest.neurotransmitters:manifest.classes).forEach((name,i)=>{const span=document.createElement('span'),swatch=document.createElement('i');swatch.style.background=palette[i%palette.length];span.append(swatch,document.createTextNode(name.replaceAll('_',' ')));$('legend').append(span);});
  rebuildLines();if(selected<0)view(currentView);dirty=true;
}
function rebuildLines(){
  const limit=selected>=0?5000:Number($('budget').value), min=Number($('weight').value);
  $('weight-label').value=String(min);
  const source=selected>=0?(selectedEdges||new Uint32Array()):overview;
  const edges=selectEdges(source,neurons,{...filter(),minimum:min,limit,source:selected});
  currentEdges=edges;
  const p=new Float32Array(edges.length*2),colours=new Float32Array(edges.length*2),targetPositions=[];
  const from=new THREE.Color(selected>=0?'#8ef0d2':'#5abdd7'),to=new THREE.Color(selected>=0?'#ffc77d':'#8c9bd9');
  const maxWeight=Math.max(1,...edges.filter((_,i)=>i%3===2).slice(0,5000));
  for(let i=0;i<edges.length;i+=3){p.set(positions.subarray(edges[i]*3,edges[i]*3+3),i*2);p.set(positions.subarray(edges[i+1]*3,edges[i+1]*3+3),i*2+3);
    const strength=.2+.8*Math.sqrt(Math.min(1,edges[i+2]/maxWeight));
    colours.set([from.r*strength,from.g*strength,from.b*strength,to.r*strength,to.g*strength,to.b*strength],i*2);
    if(selected>=0)targetPositions.push(...positions.subarray(edges[i+1]*3,edges[i+1]*3+3));
  }
  partners.geometry.dispose();partners.geometry=new THREE.BufferGeometry();partners.geometry.setAttribute('position',new THREE.Float32BufferAttribute(targetPositions,3));
  dots.material.opacity=selected>=0?.12:.72;
  $('network-guide').hidden=selected>=0;
  const contrast=Number($('contrast').value);$('contrast-label').value=['Subtle','Soft','Balanced','Bright','Vivid'][contrast-1];
  lines.geometry.dispose();lines.geometry=new THREE.BufferGeometry();lines.geometry.setAttribute('position',new THREE.BufferAttribute(p,3));lines.geometry.setAttribute('color',new THREE.BufferAttribute(colours,3));lines.material.opacity=selected>=0?.35+contrast*.12:.035+contrast*.045;
  const count=edges.length/3;
  $('visible-count').textContent=`${fmt(visibleIndices.length)} neurons · ${fmt(count)} ${selected>=0?'outgoing':'overview'} links`;
  dirty=true;
}
async function inspect(i){
  const epoch=++selectionEpoch;selected=i;selectedEdges=null;const n=neurons[i];
  $('inspector').hidden=false;document.querySelector('main').classList.add('has-selection');$('cell-type').textContent=n[5]||'Unclassified neuron';$('cell-id').textContent=n[0];
  $('cell-details').replaceChildren();
  for(const [key,value] of Object.entries({'Class':manifest.classes[n[4]].replaceAll('_',' '),'Predicted transmitter':manifest.neurotransmitters[n[6]],'Side':n[7],'Position':n[8]?'Recorded soma':'Recorded anchor','Incoming partners':fmt(n[9]),'Outgoing partners':fmt(n[10])})){
    const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;$('cell-details').append(dt,dd);
  }
  $('codex').href=`https://codex.flywire.ai/app/neuron_details?root_id=${encodeURIComponent(n[0])}`;
  halo.position.fromArray(positions,i*3);halo.visible=true;camera.position.add(new THREE.Vector3().subVectors(halo.position,controls.target));controls.target.copy(halo.position);controls.update();
  $('partners').replaceChildren();$('partner-status').textContent='Loading measured outgoing connections…';rebuildLines();
  try{
    const shard=Math.floor(i/manifest.shardSize), name=manifest.shards[shard].file;
    let values=cache.get(shard);
    if(!values){values=await compressed(name);if(cache.size>=3)cache.delete(cache.keys().next().value);cache.set(shard,values);}
    if(epoch!==selectionEpoch)return;
    const rows=[];for(let j=0;j<values.length;j+=3)if(values[j]===i)rows.push([values[j],values[j+1],values[j+2]]);
    rows.sort((a,b)=>b[2]-a[2]);selectedEdges=new Uint32Array(rows.flat());rebuildLines();fitSelection();
    $('partner-status').textContent=`${fmt(rows.length)} outgoing partners loaded. Lines respect filters; capped at 5,000. Strongest partners below (synapse count).`;
    rows.slice(0,15).forEach(([,target,weight])=>{const b=document.createElement('button');b.textContent=`${neurons[target][5]||neurons[target][0]} · ${fmt(weight)}`;b.onclick=()=>inspect(target);$('partners').append(b);});
  }catch(e){if(epoch===selectionEpoch)$('partner-status').textContent=`Connection data unavailable: ${e.message}`;}
}
function closeInspector(){selectionEpoch++;selected=-1;selectedEdges=null;halo.visible=false;$('inspector').hidden=true;document.querySelector('main').classList.remove('has-selection');rebuildLines();view(currentView);}
function wireControls(){
  for(const id of ['class','side','colour'])$(id).addEventListener('change',()=>{closeInspector();rebuildDots();});
  $('budget').addEventListener('change',()=>{closeInspector();rebuildLines();});$('weight').addEventListener('input',rebuildLines);$('contrast').addEventListener('input',rebuildLines);$('fit-selection').onclick=fitSelection;
  $('reset').onclick=()=>{$('class').value='all';$('side').value='all';$('weight').value='1';$('contrast').value='3';controls.autoRotate=false;$('rotate').setAttribute('aria-pressed','false');$('query').value='';$('matches').replaceChildren();closeInspector();rebuildDots();view('front');};
  $('rotate').onclick=()=>{controls.autoRotate=!controls.autoRotate;$('rotate').setAttribute('aria-pressed',String(controls.autoRotate));dirty=true;};
  $('close-inspector').onclick=closeInspector;
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));
  $('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else message('Use “Open in new browser tab” in Safari for a larger view.');}catch{message('Full screen is unavailable here. Open the project in a new browser tab.');}};
  $('search').onsubmit=e=>{e.preventDefault();const q=$('query').value.trim().toLowerCase();$('matches').replaceChildren();if(!q)return;
    const found=[];neurons.forEach((n,i)=>{if(n[0]===q||n[5].toLowerCase().includes(q))found.push(i);});
    if(!found.length){const p=document.createElement('p');p.textContent='No mapped neuron matches that ID or cell type.';$('matches').append(p);return;}
    if(found.length===1){$('class').value='all';$('side').value='all';rebuildDots();inspect(found[0]);return;}
    found.slice(0,12).forEach(i=>{const b=document.createElement('button');b.type='button';b.textContent=`${neurons[i][5]} · ${neurons[i][0]}`;b.onclick=()=>{$('class').value='all';$('side').value='all';rebuildDots();inspect(i);};$('matches').append(b);});
    const p=document.createElement('p');p.textContent=`${fmt(found.length)} matches; showing up to 12.`;$('matches').append(p);
  };
}
async function init(){
  manifest=await(await get('data/manifest.json')).json();
  [neurons,overview]=await Promise.all([compressed('neurons.json.gz',true),compressed('overview.bin.gz')]);
  if(neurons.length!==manifest.renderedNeurons)throw new Error('Dataset version mismatch. Reload to retry.');
  positions=new Float32Array(neurons.length*3);neurons.forEach((n,i)=>positions.set([n[1],-n[2],-n[3]],i*3));
  $('neuron-count').textContent=fmt(neurons.length);$('edge-count').textContent=(manifest.mappedEdges/1e6).toFixed(2)+'M';
  $('coverage').textContent=`Model: ${fmt(manifest.modelNeurons)} neurons. Mapped: ${fmt(manifest.renderedNeurons)} (${fmt(manifest.somaPositions)} somas; ${fmt(manifest.anchorPositions)} anchors). ${manifest.unmappedNeuronIds.length} IDs lack matching annotations and are not plotted. ${fmt(manifest.unmappedEdges)} connections touch unmapped neurons. The overview contains the 150,000 strongest mapped links, not every connection.`;
  manifest.classes.forEach((name,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=name.replaceAll('_',' ');$('class').append(o);});
  makeScene();rebuildDots();wireControls();$('controls').disabled=false;message('');
}
init().catch(e=>{console.error(e);message(`Unable to open the brain explorer. ${e.message}`,true);const b=document.createElement('button');b.textContent='Retry';b.onclick=()=>location.reload();status.append(document.createElement('br'),b);});
addEventListener('pagehide',()=>{stopped=true;controller.abort();cancelAnimationFrame(frame);resizeObserver?.disconnect();intersectionObserver?.disconnect();controls?.dispose();scene?.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});renderer?.dispose();pointTexture?.dispose();});
addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
