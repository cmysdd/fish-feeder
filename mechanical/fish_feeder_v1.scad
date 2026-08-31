// Fish feeder v1 - 180 degree SG90 rotary dosing cup
// Units: millimetres. Export one part at a time by changing `part` below.
// Recommended material: PETG for indoor use, ASA for outdoor use.

$fn = 64;

part = "assembly";
// part values: assembly, base, rotor, hopper, lid, servo_bracket, print_layout

wall = 2.8;
base_w = 90;
base_d = 90;
base_h = 30;
rotor_r = 30.4;
rotor_t = 9;
rotor_z = 10.5;
cup_r = 9.5;
cup_offset = 18;
inlet_r = 11.5;
servo_axis = [45, 45];

module rounded_box(size, radius = 3) {
  hull() {
    for (x = [radius, size[0] - radius])
      for (y = [radius, size[1] - radius])
        translate([x, y, 0]) cylinder(r = radius, h = size[2]);
  }
}

module mounting_holes(z0 = -1, h = 32) {
  for (x = [8, base_w - 8])
    for (y = [8, base_d - 8])
      translate([x, y, z0]) cylinder(d = 3.4, h = h);
}

module base_body() {
  difference() {
    rounded_box([base_w, base_d, base_h], 4);

    // Rotor chamber. About 1 mm axial clearance lets the top plate scrape
    // excess pellets from the dosing pocket without binding.
    translate([45, 45, 12.5]) cylinder(r = 31.6, h = 16, center = true);

    // Fill opening at the closed/home position.
    translate([45, 45 - cup_offset, 19]) cylinder(r = inlet_r, h = 14);

    // Discharge opening is opposite the fill opening.
    translate([45, 45 + cup_offset, -1]) cylinder(r = inlet_r, h = 12);

    // SG90 output shaft and optional 3 mm support axle clearance.
    translate([45, 45, -1]) cylinder(d = 6.4, h = 32);

    // Four M3 mounting holes for a bottom plate or aquarium bracket.
    mounting_holes();
  }
}

module rotor() {
  difference() {
    union() {
      translate([45, 45, rotor_z]) cylinder(r = rotor_r, h = rotor_t);
      // Low-profile hub gives the rotor a stable bearing surface.
      translate([45, 45, rotor_z - 2]) cylinder(r = 7.5, h = rotor_t + 4);
    }

    // Fixed-volume through pocket. Replace the rotor to change the dose.
    translate([45, 45 - cup_offset, rotor_z - 1]) cylinder(r = cup_r, h = rotor_t + 2);
    translate([45, 45, rotor_z - 3]) cylinder(d = 3.4, h = rotor_t + 6);

    // M2.2 holes for the original SG90 horn. Use two opposing holes first.
    for (a = [0, 90, 180, 270])
      translate([45 + 6 * cos(a), 45 + 6 * sin(a), rotor_z - 1])
        cylinder(d = 2.2, h = rotor_t + 2);

    // Shallow recesses for M2 screw heads on the underside.
    for (a = [0, 90, 180, 270])
      translate([45 + 6 * cos(a), 45 + 6 * sin(a), rotor_z - 2])
        cylinder(d = 4.5, h = 1.4);
  }
}

module rect_frustum(z0, z1, bottom_w, bottom_d, top_w, top_d) {
  hull() {
    translate([45 - bottom_w / 2, 45 - bottom_d / 2, z0]) cube([bottom_w, bottom_d, 0.1]);
    translate([45 - top_w / 2, 45 - top_d / 2, z1]) cube([top_w, top_d, 0.1]);
  }
}

module hopper() {
  difference() {
    rect_frustum(33, 155, 40, 40, 115, 95);
    translate([0, 0, wall]) rect_frustum(33, 156, 32, 32, 109.4, 89.4);
  }

  // Wide flange spreads load and provides a gasket surface.
  difference() {
    translate([1, 1, 29]) rounded_box([88, 88, 5], 4);
    translate([45, 45, 28]) cylinder(r = inlet_r + 1, h = 8);
    mounting_holes(28, 8);
  }
}

module lid() {
  // Simple removable lid with a short locating lip.
  translate([45, 45, 155]) rounded_box([115, 95, 4], 5);
  difference() {
    translate([45, 45, 151]) rounded_box([108, 88, 6], 4);
    translate([45, 45, 150]) rounded_box([103, 83, 8], 3.5);
  }
}

module servo_bracket() {
  // U cradle for an SG90 installed below the base with its shaft upward.
  // Inner cavity: 24 x 16 x 30, suitable for common SG90/MG90S bodies.
  difference() {
    union() {
      translate([28, 31, -38]) rounded_box([34, 28, 4], 2);
      translate([28, 31, -38]) cube([4, 28, 34]);
      translate([58, 31, -38]) cube([4, 28, 34]);
      // Top tabs fasten to the base with M3 screws.
      translate([24, 31, -4]) cube([42, 5, 4]);
      translate([24, 54, -4]) cube([42, 5, 4]);
    }

    for (x = [29, 61])
      for (y = [34, 57])
        translate([x, y, -6]) cylinder(d = 3.4, h = 8);
    // Cable relief at the rear of the cradle.
    translate([43, 53, -32]) cube([14, 8, 18]);
  }
}

module mounting_plate() {
  // Optional flat plate for a tank rim or shelf. Drill/slot it to suit the tank.
  difference() {
    translate([0, -14, -5]) rounded_box([90, 14, 5], 2);
    for (x = [12, 78]) translate([x, -8, -6]) cylinder(d = 4.2, h = 8);
  }
}

module assembly() {
  color("#5b6970") base_body();
  color("#d68c4a") rotor();
  color("#7da9a0", 0.88) hopper();
  color("#98b7b0", 0.9) lid();
  color("#30363a") servo_bracket();
  color("#30363a") mounting_plate();
}

module print_layout() {
  // Spaced layout for a single build plate. Export parts separately for best fit.
  translate([0, 0, 0]) base_body();
  translate([105, 0, 0]) rotor();
  translate([0, 120, 0]) hopper();
  translate([130, 120, 0]) lid();
  translate([0, 230, 0]) servo_bracket();
}

if (part == "base") base_body();
else if (part == "rotor") rotor();
else if (part == "hopper") hopper();
else if (part == "lid") lid();
else if (part == "servo_bracket") servo_bracket();
else if (part == "print_layout") print_layout();
else assembly();
