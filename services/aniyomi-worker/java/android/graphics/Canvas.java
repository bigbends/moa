package android.graphics;
public final class Canvas {
 private final Bitmap bitmap;
 public Canvas(Bitmap value) { bitmap=value; }
 private java.awt.Graphics2D graphics(Paint p) {
  var g=bitmap.image.createGraphics();g.setRenderingHint(java.awt.RenderingHints.KEY_ANTIALIASING,java.awt.RenderingHints.VALUE_ANTIALIAS_ON);
  g.setPaint(p.shader==null?new java.awt.Color(p.color,true):p.shader.paint());g.setFont(p.font());return g;
 }
 public void drawColor(int color) { var p=new Paint();p.color=color;drawRect(0,0,bitmap.getWidth(),bitmap.getHeight(),p); }
 public void drawRect(float l,float t,float r,float b,Paint p) { var g=graphics(p);try{g.fill(new java.awt.geom.Rectangle2D.Float(l,t,r-l,b-t));}finally{g.dispose();} }
 public void drawCircle(float x,float y,float radius,Paint p) { var g=graphics(p);try{g.fill(new java.awt.geom.Ellipse2D.Float(x-radius,y-radius,radius*2,radius*2));}finally{g.dispose();} }
 public void drawText(String text,float x,float y,Paint p) { var g=graphics(p);try{float width=p.measureText(text);g.drawString(text,p.align==Paint.Align.CENTER?x-width/2:p.align==Paint.Align.RIGHT?x-width:x,y);}finally{g.dispose();} }
}
