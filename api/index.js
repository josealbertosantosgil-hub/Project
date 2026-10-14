const crypto=require('crypto');
const {Pool,types}=require('pg');
types.setTypeParser(1114,v=>v.slice(0,19));types.setTypeParser(1082,v=>v);types.setTypeParser(20,Number);
let pool;
const db=()=>{if(!pool){pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:1});pool.on('connect',c=>c.query("SET TIME ZONE 'America/Mazatlan'"))}return pool};
const pg=s=>{let i=0;return s.replace(/\?/g,()=>'$'+ ++i)};
const Q=async(s,p=[])=>(await db().query(pg(s),p)).rows;
const strip=r=>r.map(({password_hash,...x})=>x);
const T={
productos:['id_producto',['codigo_barras','nombre','precio_compra','precio_venta','stock','id_categoria','id_proveedor']],
categorias:['id_categoria',['nombre','descripcion']],
clientes:['id_cliente',['rfc','nombre','telefono','email']],
proveedores:['id_proveedor',['rfc','razon_social','telefono','email']],
usuarios:['id_usuario',['username','password_hash','nombre','rol','activo']]};
const R={
top:['Productos más vendidos','SELECT * FROM vw_mas_vendidos'],
cat:['Ventas por categoría','SELECT * FROM vw_ventas_categoria'],
vend:['Ventas por vendedor','SELECT * FROM vw_ventas_vendedor'],
gan:['Ganancia por producto','SELECT * FROM vw_ganancia_producto'],
cli:['Gasto por cliente','SELECT cliente,compras,gastado FROM vw_clientes_gasto ORDER BY gastado DESC'],
prom:['Clientes sobre el promedio de gasto','SELECT cliente,compras,gastado FROM vw_clientes_gasto WHERE gastado>(SELECT AVG(gastado) FROM vw_clientes_gasto WHERE compras>0) ORDER BY gastado DESC'],
stock:['Productos con stock bajo','SELECT nombre,stock FROM productos WHERE stock<=? ORDER BY stock','Stock máximo',10],
nunca:['Productos que nunca se han vendido','SELECT nombre,stock FROM productos p WHERE NOT EXISTS(SELECT 1 FROM detalle_ventas d WHERE d.id_producto=p.id_producto)'],
dias:['Ventas de los últimos días',`SELECT v.id_venta,v.fecha_hora,c.nombre cliente,v.total FROM ventas v JOIN clientes c USING(id_cliente) WHERE v.estado='COMPLETADA' AND v.fecha_hora>=NOW()-CAST(? AS integer)*INTERVAL '1 day' ORDER BY 2 DESC`,'Días',30],
diario:['Ventas por día',`SELECT fecha_hora::date dia,COUNT(*) ventas,SUM(total) total FROM ventas WHERE estado='COMPLETADA' GROUP BY 1 ORDER BY 1 DESC`],
inv:['Valor del inventario por categoría','SELECT c.nombre categoria,SUM(p.stock) unidades,SUM(p.stock*p.precio_compra) costo,SUM(p.stock*p.precio_venta) valor_venta FROM productos p JOIN categorias c USING(id_categoria) GROUP BY c.id_categoria,c.nombre'],
canc:['Ventas canceladas',`SELECT v.id_venta,v.fecha_hora,c.nombre cliente,v.total FROM ventas v JOIN clientes c USING(id_cliente) WHERE v.estado='CANCELADA' ORDER BY 1 DESC`]};
const hash=x=>{const s=crypto.randomBytes(8).toString('hex');return 's$'+s+'$'+crypto.scryptSync(x,s,32).toString('hex')};
const auth=h=>{const [u,p]=Buffer.from((h||'').replace(/^Basic /,''),'base64').toString().split(/:(.*)/s);return u===(process.env.APP_USER||'admin')&&p===process.env.APP_PASSWORD};
module.exports=async(req,res)=>{
const out=(d,c=200)=>{res.setHeader('Cache-Control','no-store');res.status(c).json(d)};
try{
if(process.env.APP_PASSWORD&&!auth(req.headers.authorization)){res.setHeader('WWW-Authenticate','Basic realm="POS"');return out({error:'No autorizado'},401)}
if(!process.env.DATABASE_URL)return out({error:'Falta la variable DATABASE_URL en Vercel'});
const {a='',t='',only='',id='',d='',h='',e='',n=''}=req.query;
let b=req.body;if(typeof b==='string')b=b?JSON.parse(b):{};b=b||{};
if(t&&!T[t])throw new Error('Tabla inválida');
switch(a){
case 'list':return out(strip(await Q(`SELECT * FROM ${t} ORDER BY 1 DESC`)));
case 'all':{const o={};for(const k in T)if(!only||only.split(',').includes(k))o[k]=strip(await Q(`SELECT * FROM ${k} ORDER BY 1 DESC`));return out(o)}
case 'save':{const [pk,cols]=T[t],v={};
 for(const c of cols){let x=String(b[c]??'').trim();if(c==='password_hash'){if(x==='')continue;x=hash(x)}v[c]=x===''?null:x}
 const k=Object.keys(v),p=k.map(c=>v[c]);
 if(b[pk])await Q(`UPDATE ${t} SET ${k.map(c=>c+'=?').join(',')} WHERE ${pk}=?`,[...p,b[pk]]);
 else await Q(`INSERT INTO ${t}(${k.join(',')}) VALUES(${k.map(()=>'?').join(',')})`,p);
 return out({ok:1})}
case 'del':await Q(`DELETE FROM ${t} WHERE ${T[t][0]}=?`,[b.id]);return out({ok:1});
case 'venta':{if(!b.items?.length)throw new Error('Carrito vacío');const c=await db().connect();
 try{await c.query('BEGIN');
  const vid=(await c.query('INSERT INTO ventas(id_cliente,id_usuario) VALUES($1,$2) RETURNING id_venta',[b.cliente,b.usuario])).rows[0].id_venta;
  for(const i of b.items){const p=(await c.query('SELECT stock,precio_venta FROM productos WHERE id_producto=$1',[i.id])).rows[0];
   if(!p||p.stock<i.cant)throw new Error('Stock insuficiente');
   await c.query('INSERT INTO detalle_ventas(id_venta,id_producto,cantidad,precio_unitario) VALUES($1,$2,$3,$4)',[vid,i.id,i.cant,p.precio_venta])}
  await c.query('COMMIT');
  return out({id:vid,total:(await c.query('SELECT total FROM ventas WHERE id_venta=$1',[vid])).rows[0].total})
 }catch(x){await c.query('ROLLBACK');throw x}finally{c.release()}}
case 'ventas':return out(await Q(`SELECT v.id_venta,v.fecha_hora,c.nombre cliente,u.nombre vendedor,v.total,v.estado FROM ventas v JOIN clientes c USING(id_cliente) JOIN usuarios u USING(id_usuario) WHERE v.fecha_hora::date BETWEEN CAST(? AS date) AND CAST(? AS date) AND (CAST(? AS text)='' OR v.estado=CAST(? AS text)) ORDER BY 1 DESC`,[d||'2000-01-01',h||'2999-12-31',e,e]));
case 'detalle':return out(await Q('SELECT p.nombre,d.cantidad,d.precio_unitario,d.subtotal FROM detalle_ventas d JOIN productos p USING(id_producto) WHERE d.id_venta=?',[id]));
case 'ticket':{const r=(await Q('SELECT v.id_venta,v.fecha_hora,c.nombre cliente,u.nombre cajero,v.total,v.estado FROM ventas v JOIN clientes c USING(id_cliente) JOIN usuarios u USING(id_usuario) WHERE v.id_venta=?',[id]))[0];
 if(!r)throw new Error('Venta no encontrada');
 r.items=await Q('SELECT p.nombre,p.codigo_barras,d.cantidad,d.precio_unitario,d.subtotal FROM detalle_ventas d JOIN productos p USING(id_producto) WHERE d.id_venta=?',[id]);return out(r)}
case 'cancelar':await Q(`UPDATE ventas SET estado='CANCELADA' WHERE id_venta=? AND estado='COMPLETADA'`,[b.id]);return out({ok:1});
case 'resumen':return out((await Q(`SELECT (SELECT COUNT(*) FROM productos) productos,(SELECT COUNT(*) FROM productos WHERE stock<=10) stock_bajo,(SELECT COUNT(*) FROM clientes) clientes,(SELECT COUNT(*) FROM ventas WHERE estado='COMPLETADA') ventas,(SELECT COALESCE(SUM(total),0) FROM ventas WHERE estado='COMPLETADA') ingresos,(SELECT COALESCE(SUM(total),0) FROM ventas WHERE estado='COMPLETADA' AND fecha_hora::date=CURRENT_DATE) hoy`))[0]);
case 'sync':return out(Object.fromEntries((await Q('SELECT tabla,version FROM cambios')).map(r=>[r.tabla,r.version])));
case 'rlist':return out(Object.entries(R).map(([k,v])=>({id:k,t:v[0],p:v[2]??null,d:v[3]??0})));
case 'run':{const r=R[id];if(!r)throw new Error('Reporte inválido');return out(await Q(r[1],r[2]?[Math.max(1,parseInt(n||r[3]))]:[]))}
}
throw new Error('Acción inválida');
}catch(x){out({error:/^23/.test(x.code||'')?'No se pudo guardar o eliminar: hay registros relacionados o datos repetidos.':x.message})}
};
