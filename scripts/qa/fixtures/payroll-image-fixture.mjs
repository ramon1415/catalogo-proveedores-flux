// Synthetic pixels only. No customer receipts, names or bank data.
import { deflateSync } from 'node:zlib'
export function pngChunk(type, data) {
  const body=Buffer.concat([Buffer.from(type),data])
  let crc=0xffffffff
  for(const byte of body){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}
  const result=Buffer.alloc(data.length+12)
  result.writeUInt32BE(data.length,0);body.copy(result,4);result.writeUInt32BE((crc^0xffffffff)>>>0,result.length-4)
  return result
}
export function syntheticPng(){
  const width=16,height=8,header=Buffer.alloc(13)
  header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2
  const rows=Buffer.alloc(height*(1+width*3))
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const index=y*(1+width*3)+1+x*3
    rows[index]=(x*17+y*29)%256;rows[index+1]=(x*31+y*13)%256;rows[index+2]=(x*53+y*11)%256
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('IDAT',deflateSync(rows)),pngChunk('IEND',Buffer.alloc(0))])
}
export const syntheticJpeg=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAAEAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAgEAAABgICAwAAAAAAAAAAAAABAgMEBxEABgUSFBUi/8QAFQEBAQAAAAAAAAAAAAAAAAAAAQT/xAAcEQACAgIDAAAAAAAAAAAAAAABAgMEABEhUYH/2gAMAwEAAhEDEQA/AKNRBCUYwNrTnUIo1n0fEPHx+SWb+a4c9nJ000zH7LqHMFkSTCgGvm6sRtjGUW7di/M1m1IXkbksxLMT2Sdk+4KoUaUaGf/Z','base64')
export function withExifOrientation(bytes,orientation){
  const exif=Buffer.alloc(36)
  exif[0]=0xff;exif[1]=0xe1;exif.writeUInt16BE(34,2);exif.write('Exif\0\0',4)
  exif.write('II',10);exif.writeUInt16LE(42,12);exif.writeUInt32LE(8,14)
  exif.writeUInt16LE(1,18);exif.writeUInt16LE(0x0112,20);exif.writeUInt16LE(3,22)
  exif.writeUInt32LE(1,24);exif.writeUInt16LE(orientation,28)
  return Buffer.concat([bytes.subarray(0,2),exif,bytes.subarray(2)])
}
