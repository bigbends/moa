package android.graphics;
public final class LinearGradient extends Shader {
 private final java.awt.Paint value;
 public LinearGradient(float x0,float y0,float x1,float y1,int c0,int c1,TileMode mode) {
  if(mode!=TileMode.CLAMP) throw new UnsupportedOperationException("gradient_mode_unsupported");
  value=new java.awt.GradientPaint(x0,y0,new java.awt.Color(c0,true),x1,y1,new java.awt.Color(c1,true));
 }
 java.awt.Paint paint() { return value; }
}
