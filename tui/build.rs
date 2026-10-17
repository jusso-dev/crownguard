// The catalogue under ../content is embedded with include_dir!, so rebuild whenever any of it changes.
fn main() {
    println!("cargo:rerun-if-changed=../content");
}
