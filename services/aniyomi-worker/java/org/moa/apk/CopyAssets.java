package org.moa.apk;
import java.util.zip.*;
import java.nio.file.*;
/** dex2jar drops assets. Preserve the bounded APK asset namespace in the executable archive. */
public final class CopyAssets {
 public static void main(String[] args) throws Exception {
  Path target=Path.of(args[1]),temp=Path.of(args[1]+".assets");
  try(var output=new ZipOutputStream(Files.newOutputStream(temp));var jar=new ZipFile(target.toFile());var apk=new ZipFile(args[0])) {
   for(var zip:new ZipFile[]{jar,apk}) {
    var entries=zip.entries();long size=0;
    while(entries.hasMoreElements()) {
     var entry=entries.nextElement();String name=entry.getName();if(zip==apk&&!name.startsWith("assets/"))continue;
     if(name.startsWith("/")||name.contains("..")||name.contains("\\"))throw new IllegalArgumentException("invalid_entry");
     if((size+=entry.getSize())>64*1024*1024)throw new IllegalArgumentException("asset_limit");
     var next=new ZipEntry(name);next.setTime(0);output.putNextEntry(next);
     try(var in=zip.getInputStream(entry)){in.transferTo(output);}output.closeEntry();
    }
   }
  } catch(Throwable e) { Files.deleteIfExists(temp);throw e; }
  Files.move(temp,target,StandardCopyOption.REPLACE_EXISTING);
 }
}
