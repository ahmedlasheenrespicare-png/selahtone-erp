import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CHUNK_BYTES, planChunks, readBoundedChunk, verifyDownloadChunk, verifyUpload } from "../prototypes/finance-storage/chunk-protocol";
import { inspectAttachmentMetadata, MAX_ATTACHMENT_BYTES } from "../prototypes/finance-engine/attachment-validation";
import { FinanceProblem } from "../prototypes/finance-engine/types";

const code=(error:unknown)=>error instanceof FinanceProblem && error.code==="invalid_attachment";
const sample=(size:number)=>{const bytes=new Uint8Array(size);bytes.set(new TextEncoder().encode("%PDF-1.7\n"));for(let i=9;i<size;i++)bytes[i]=i%251;return bytes;};
const parts=(bytes:Uint8Array)=>planChunks(bytes.length).map(({index,offset,length})=>({index,bytes:bytes.subarray(offset,offset+length)}));
function request(chunks:Uint8Array[],headers:Record<string,string>={}):Request {
  const stream=new ReadableStream<Uint8Array>({start(controller){for(const chunk of chunks)controller.enqueue(chunk);controller.close();}});
  return new Request("http://finance-lab.invalid/chunk",{method:"POST",headers:{"content-type":"application/octet-stream",...headers},body:stream,duplex:"half"} as RequestInit & {duplex:"half"});
}

test("metadata is bounded and validates filename, claimed type and extension before any allocation",()=>{
 assert.deepEqual(inspectAttachmentMetadata("  invoice.PDF  ","application/pdf",5),{filename:"invoice.PDF",mediaType:"application/pdf",size:5});
 for(const [name,type,size] of [["../x.pdf","application/pdf",5],["x.pdf","image/png",5],["x.png","image/png",0],["x.pdf","application/pdf",5_000_001],["x.pdf","application/pdf",Infinity],["x\u202epdf.pdf","application/pdf",5],["x.pdf","text/html",5]] as const){
  assert.throws(()=>inspectAttachmentMetadata(name,type,size),code);
 }
});
test("5 MB fits ten bounded, contiguous parts and rejects invalid plans",()=>{
 const plan=planChunks(MAX_ATTACHMENT_BYTES);assert.equal(plan.length,10);assert.equal(plan[0].length,CHUNK_BYTES);assert.equal(plan[9].length,392_000);
 assert.equal(plan.reduce((n,p)=>n+p.length,0),5_000_000);assert(plan.every((p,i)=>p.offset===i*CHUNK_BYTES));
 for(const size of [0,4,5_000_001,NaN,Infinity,2.2,"5"])assert.throws(()=>planChunks(size),code);
 assert(plan.every(p=>4*Math.ceil(p.length/3)<6_000_000)); // body-only estimate, not a Netlify integration test
});
test("a chunk reader enforces the stream size even when length is absent or dishonest",async()=>{
 const bytes=sample(20),good=request([bytes.subarray(0,7),bytes.subarray(7)],{"content-length":"20"});
 assert.deepEqual(await readBoundedChunk(good,20,0),bytes);
 assert.deepEqual(await readBoundedChunk(request([bytes]),20,0),bytes);
 await assert.rejects(()=>readBoundedChunk(request([bytes],{"content-length":"19"}),20,0),code);
 await assert.rejects(()=>readBoundedChunk(request([bytes.subarray(0,19)]),20,0),code);
 await assert.rejects(()=>readBoundedChunk(request([bytes,new Uint8Array([1])]),20,0),code);
 await assert.rejects(()=>readBoundedChunk(request([bytes],{"content-type":"text/plain"}),20,0),code);
 await assert.rejects(()=>readBoundedChunk(request([bytes],{"content-encoding":"gzip"}),20,0),code);
 await assert.rejects(()=>readBoundedChunk(request([bytes],{"content-length":"20, 20"}),20,0),code);
 await assert.rejects(()=>readBoundedChunk(request([bytes]),20,1),code);
 const manyTinyPieces=Array.from({length:bytes.length},(_,i)=>bytes.subarray(i,i+1));
 assert.deepEqual(await readBoundedChunk(request(manyTinyPieces),20,0),bytes);
});
test("uncooperative or stalled request streams cannot hold the reader forever",async()=>{
 const stalled=new ReadableStream<Uint8Array>({pull(){return new Promise<void>(()=>{});},cancel(){return new Promise<void>(()=>{});}});
 const req=new Request("http://finance-lab.invalid/chunk",{method:"POST",headers:{"content-type":"application/octet-stream"},body:stalled,duplex:"half"} as RequestInit & {duplex:"half"});
 const started=Date.now();await assert.rejects(()=>readBoundedChunk(req,20,0,25),code);assert(Date.now()-started<1000);
 const tooBig=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(21));},cancel(){return new Promise<void>(()=>{});}});
 const req2=new Request("http://finance-lab.invalid/chunk",{method:"POST",headers:{"content-type":"application/octet-stream"},body:tooBig,duplex:"half"} as RequestInit & {duplex:"half"});
 await assert.rejects(()=>readBoundedChunk(req2,20,0,100),code);
});
test("upload assembly rejects missing, duplicate, incorrect-length and spoofed contents",()=>{
 const original=sample(MAX_ATTACHMENT_BYTES),all=parts(original),verified=verifyUpload(" receipt.PDF ","application/pdf",original.length,[...all].reverse());
 assert.equal(verified.metadata.filename,"receipt.PDF");assert.equal(verified.sha256,createHash("sha256").update(original).digest("hex"));
 assert.equal(verified.chunkHashes.length,10);assert.deepEqual(verified.bytes,original);
 all[0].bytes[0]=0;assert.equal(verified.bytes[0],0x25,"verified body is a snapshot, not a mutable input reference");
 assert.throws(()=>verifyUpload("x.pdf","application/pdf",original.length,all),code);
 const valid=parts(sample(MAX_ATTACHMENT_BYTES));
 assert.throws(()=>verifyUpload("x.pdf","application/pdf",original.length,valid.slice(1)),code);
 assert.throws(()=>verifyUpload("x.pdf","application/pdf",original.length,[...valid.slice(0,9),valid[0]]),code);
 assert.throws(()=>verifyUpload("x.pdf","application/pdf",original.length,[...valid.slice(0,9),{...valid[9],bytes:valid[9].bytes.subarray(1)}]),code);
 assert.throws(()=>verifyUpload("x.png","image/png",original.length,valid),code);
});
test("download parts are checked against trusted server-side hashes and returned as copies",()=>{
 const original=sample(1_100_000),all=parts(original),verified=verifyUpload("x.pdf","application/pdf",original.length,all);
 for(const part of all)assert.deepEqual(verifyDownloadChunk(original.length,part.index,verified.chunkHashes,part.bytes),part.bytes);
 const corrupt=new Uint8Array(all[1].bytes);corrupt[42]^=1;
 assert.throws(()=>verifyDownloadChunk(original.length,1,verified.chunkHashes,corrupt),code);
 assert.throws(()=>verifyDownloadChunk(original.length,1,verified.chunkHashes,all[1].bytes.subarray(1)),code);
 assert.throws(()=>verifyDownloadChunk(original.length,99,verified.chunkHashes,all[1].bytes),code);
 assert.throws(()=>verifyDownloadChunk(original.length,1,["not-a-hash"],all[1].bytes),code);
 const safe=verifyDownloadChunk(original.length,0,verified.chunkHashes,all[0].bytes);all[0].bytes[0]=0;assert.equal(safe[0],0x25);
});
