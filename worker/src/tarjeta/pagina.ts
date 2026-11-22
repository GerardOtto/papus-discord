// La página de /tarjeta/: elegir los cosméticos tocando sus imágenes (las miniaturas de la tienda, /tarjeta/mini/<id>.png,
// que sube npm run worker:deploy), ver la tarjeta real con «Vista previa» y aplicarla con «Guardar». Sin dependencias.
export const PAGINA = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Mi tarjeta · Papus</title>
<style>
:root{--bg:#16131f;--panel:#211c30;--panel2:#2b2540;--txt:#ece9f5;--sub:#b9b2cf;--borde:#39304f;--acento:#39C5BB}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:16px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
header{max-width:1200px;margin:auto;padding:22px 16px 6px}h1{margin:0;font-size:26px}header p{margin:4px 0 0;color:var(--sub)}
.vista{max-width:1200px;margin:10px auto;padding:0 16px}.marco{background:var(--panel);border-radius:14px;padding:10px;display:flex;flex-direction:column;gap:10px}
.marco img{width:100%;border-radius:10px;display:block;background:#0d0b14;aspect-ratio:1000/340;object-fit:cover}
.acciones{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
button{font:inherit;border-radius:10px;border:1px solid var(--borde);background:var(--panel2);color:var(--txt);padding:9px 16px;cursor:pointer}
button.prim{background:var(--acento);border-color:var(--acento);color:#10121a;font-weight:700}button:disabled{opacity:.5;cursor:default}
.estado{color:var(--sub);font-size:14px}.lado{display:flex;gap:6px;align-items:center;color:var(--sub);font-size:14px}.lado button{padding:6px 12px}.lado button.on{background:#3a3354;border-color:var(--acento)}
nav{position:sticky;top:0;z-index:2;background:rgba(22,19,31,.95);backdrop-filter:blur(6px);border-bottom:1px solid var(--borde)}
nav div{max-width:1200px;margin:auto;padding:8px 16px;display:flex;gap:6px;overflow-x:auto}nav button{white-space:nowrap;padding:6px 12px;font-size:14px;border-radius:99px}
nav button.on{background:var(--acento);color:#10121a;border-color:var(--acento)}
main{max-width:1200px;margin:auto;padding:14px 16px 60px}.ayuda{color:var(--sub);font-size:14px;margin:0 0 10px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:10px}
.obj{background:var(--panel);border:2px solid transparent;border-radius:12px;padding:6px;cursor:pointer;text-align:center;font-size:13px;color:var(--sub);position:relative}
.obj img{width:100%;aspect-ratio:1;border-radius:9px;display:block}.obj.on{border-color:var(--acento);background:#20363a;color:var(--txt)}
.obj .n{margin-top:5px;line-height:1.2;min-height:2.4em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.obj .tic{position:absolute;top:8px;left:8px;background:var(--acento);color:#10121a;border-radius:99px;width:24px;height:24px;font-weight:800;display:none;align-items:center;justify-content:center}
.obj.on .tic{display:flex}.nada{display:flex;align-items:center;justify-content:center;aspect-ratio:1;border-radius:9px;background:var(--panel2);font-size:30px}
.error{max-width:600px;margin:80px auto;padding:20px;text-align:center;background:var(--panel);border-radius:14px}
</style></head><body>
<div id="app"><div class="error">Cargando…</div></div>
<script>
const TIPOS=[["fondo","Fondo"],["borde","Borde"],["barra","Barra de XP"],["aro","Aro"],["nombre","Nombre"],["insignia","Insignias"],["titulo","Título"]];
const tok=new URLSearchParams(location.search).get("t")||"";
const api=(p,o)=>fetch("/tarjeta/api/s/"+tok+p,o).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"Algo falló");return j});
let D=null,E=null,tipo="fondo",ocupado=false;
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function error(msg){document.getElementById("app").innerHTML='<div class="error"><h2>😿</h2><p>'+esc(msg)+'</p></div>'}
function copia(e){return JSON.parse(JSON.stringify(e))}
function pinta(){
  const objs=D.objetos.filter(o=>o.tipo===tipo);
  const sel=id=>tipo==="insignia"?E.insignias.includes(id):E[tipo]===id;
  const cuenta=t=>D.objetos.filter(o=>o.tipo===t).length;
  $("nav div").innerHTML=TIPOS.map(([t,n])=>'<button data-t="'+t+'" class="'+(t===tipo?"on":"")+'">'+n+" ("+cuenta(t)+")</button>").join("");
  $(".ayuda").textContent=tipo==="insignia"?"Toca hasta 3 insignias (van junto a tu nombre). Toca otra vez para quitarla.":"Toca uno para ponértelo. «La de siempre» lo quita.";
  const nada=tipo==="insignia"?"":'<div class="obj '+(E[tipo]===null?"on":"")+'" data-id=""><span class="tic">✓</span><div class="nada">🚫</div><div class="n">La de siempre</div></div>';
  $(".grid").innerHTML=nada+objs.map(o=>'<div class="obj '+(sel(o.id)?"on":"")+'" data-id="'+esc(o.id)+'" title="'+esc(o.nombre)+'"><span class="tic">✓</span><img loading="lazy" src="/tarjeta/mini/'+esc(o.id)+'.png" alt=""><div class="n">'+esc(o.nombre)+"</div></div>").join("")||'<p class="ayuda">Aún no tienes de estos. Consíguelos en /tienda.</p>';
  document.querySelectorAll(".lado button").forEach(b=>b.classList.toggle("on",b.dataset.l===E.lado));
  const cambios=JSON.stringify(E)!==JSON.stringify(D.equipado);
  $("#guardar").disabled=ocupado||!cambios;$("#vista").disabled=ocupado;
}
async function pedir(clase){
  ocupado=true;pinta();$(".estado").textContent=clase==="guardar"?"Guardando…":"Dibujando tu tarjeta…";
  try{
    const {id}=await api("/pedido",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({tipo:clase,eleccion:E})});
    for(let i=0;i<40;i++){
      await new Promise(r=>setTimeout(r,1500));
      const r=await api("/pedido/"+id);
      if(r.estado==="listo"||r.estado==="error"){
        if(r.imagen)$(".marco img").src="/tarjeta/api/s/"+tok+"/pedido/"+id+"/imagen";
        $(".estado").textContent=r.mensaje||(r.estado==="listo"?"¡Listo!":"No se pudo");
        if(clase==="guardar"&&r.estado==="listo"){const s=await api("");D=s;E=copia(s.equipado)}
        return;
      }
    }
    $(".estado").textContent="El bot está tardando. Prueba de nuevo en un rato.";
  }catch(e){$(".estado").textContent=e.message}
  finally{ocupado=false;pinta()}
}
async function inicio(){
  if(!tok)return error("Este enlace no sirve. Pide uno en Discord: /tienda → Mi tarjeta → Personalizar en la web.");
  try{D=await api("")}catch(e){return error(e.message)}
  E=copia(D.equipado);
  document.getElementById("app").innerHTML='<header><h1>🎨 La tarjeta de '+esc(D.nombre)+'</h1><p>Elige tocando las imágenes. «Vista previa» dibuja tu tarjeta de verdad; «Guardar» la deja así en /nivel. El enlace vence en 30 minutos.</p></header>'
  +'<section class="vista"><div class="marco"><img alt="Tu tarjeta" src="'+(D.tarjeta?"data:image/jpeg;base64,"+D.tarjeta:"")+'"><div class="acciones"><button id="vista">👁️ Vista previa</button><button id="guardar" class="prim">💾 Guardar</button><span class="lado">Datos: <button data-l="izquierda">⬅️ Izquierda</button><button data-l="derecha">➡️ Derecha</button></span><span class="estado"></span></div></div></section>'
  +'<nav><div></div></nav><main><p class="ayuda"></p><div class="grid"></div></main>';
  $("nav").addEventListener("click",e=>{const b=e.target.closest("button");if(b){tipo=b.dataset.t;pinta();scrollTo({top:$(".vista").offsetTop+$(".vista").offsetHeight-10,behavior:"smooth"})}});
  $(".grid").addEventListener("click",e=>{const c=e.target.closest(".obj");if(!c||ocupado)return;const id=c.dataset.id;
    if(tipo==="insignia"){const i=E.insignias.indexOf(id);if(i>=0)E.insignias.splice(i,1);else if(E.insignias.length<3)E.insignias.push(id);else $(".estado").textContent="Máximo 3 insignias: quita una primero."}
    else E[tipo]=id||null;pinta()});
  $(".lado").addEventListener("click",e=>{const b=e.target.closest("button");if(b&&!ocupado){E.lado=b.dataset.l;pinta()}});
  $("#vista").onclick=()=>pedir("vista");$("#guardar").onclick=()=>pedir("guardar");
  pinta();
}
inicio();
</script></body></html>`;
