// Fish feeder v2 - SG90 180-degree fixed-volume rotary feeder
// Units: millimetres. Export one printable part at a time with `part`.
// Recommended material: PETG indoors, ASA for outdoor exposure.

$fn = 72;

part = "assembly";
// part values: assembly, base, rotor, hopper, lid, servo_bracket, outlet_chute

wall = 2.8;
base_w = 90;
base_d = 90;
base_h = 13;
axis_x = 45;
axis_y = 45;
rotor_r = 30.4;
chamber_r = 31.05;
rotor_t = 9;
rotor_z = 3.5;
cup_r = 9.5;
cup_offset = 18;
port_r = 13.5;
fill_x = axis_x;
fill_y = axis_y - cup_offset;
drop_x = axis_x;
drop_y = axis_y + cup_offset;
hopper_top_z = 145;

module rounded_box_at(origin, size, radius = 3) {
  translate(origin)
    hull() {
      for (x = [radius, size[0] - radius])
        for (y = [radius, size[1] - radius])
          translate([x, y, 0]) cylinder(r = radius, h = size[2]);
    }
}

module cover_holes(z0 = -1, h = 25, diameter = 3.4) {
  for (x = [8, base_w - 8])
    for (y = [8, base_d - 8])
      translate([x, y, z0]) cylinder(d = diameter, h = h);
}

module base_body() {
  difference() {
    rounded_box_at([0, 0, 0], [base_w, base_d, base_h], 4);

    // Open top: install the rotor, then bolt the hopper flange down as cover.
    translate([axis_x, axis_y, 3]) cylinder(r = chamber_r, h = base_h + 1);

    // Pellet outlet through the 3 mm floor.
    translate([drop_x, drop_y, -1]) cylinder(r = port_r, h = 5);

    // Clearance for the SG90 output boss. The horn sits in the chamber.
    translate([axis_x, axis_y, -1]) cylinder(d = 13.2, h = 6);

    // Long M3 bolts clamp hopper, base and lower frame together.
    cover_holes();

  }
}

module rotor() {
  difference() {
    translate([axis_x, axis_y, rotor_z]) cylinder(r = rotor_r, h = rotor_t);

    // Through pocket: about 2.55 mL before pellet packing effects.
    translate([fill_x, fill_y, rotor_z - 1])
      cylinder(r = cup_r, h = rotor_t + 2);

    // Access to the original horn centre screw.
    translate([axis_x, axis_y, rotor_z - 1]) cylinder(d = 4.2, h = rotor_t + 2);

    // Recess lets the stock SG90 horn sit inside the rotor, leaving only
    // 0.5 mm running clearance between the rotor and the base floor.
    translate([axis_x, axis_y, rotor_z - 0.1]) cylinder(d = 32.5, h = 2.8);

    // Blind pilot holes accept M2 screws from the horn side. Two radii cover
    // the common SG90 round and cross horns without weakening the food face.
    for (radius = [6, 9])
      for (a = [0, 90, 180, 270])
        translate([axis_x + radius * cos(a), axis_y + radius * sin(a), rotor_z - 0.1])
          cylinder(d = 1.8, h = 5);
  }
}

module rect_frustum(center0, center1, z0, z1, bottom_w, bottom_d, top_w, top_d) {
  hull() {
    translate([center0[0] - bottom_w / 2, center0[1] - bottom_d / 2, z0])
      cube([bottom_w, bottom_d, 0.1]);
    translate([center1[0] - top_w / 2, center1[1] - top_d / 2, z1])
      cube([top_w, top_d, 0.1]);
  }
}

module hopper() {
  // The neck is over the home-position pocket; the upper bin shifts to the
  // base centre to keep the assembled feeder balanced.
  difference() {
    rect_frustum([fill_x, fill_y], [axis_x, axis_y], 18, hopper_top_z,
                 40, 40, 115, 95);
    rect_frustum([fill_x, fill_y], [axis_x, axis_y], 18 + wall, hopper_top_z + 1,
                 34.4, 34.4, 109.4, 89.4);
  }

  // The flange is also the removable top plate of the rotor chamber.
  difference() {
    rounded_box_at([1, 1, base_h], [88, 88, 5], 4);
    translate([fill_x, fill_y, base_h - 1]) cylinder(r = port_r, h = 12);
    cover_holes(base_h - 1, 8);
  }
}

module lid() {
  // Overhanging rain lip and an inner locating rim with 0.7 mm clearance.
  rounded_box_at([-14.5, -4.5, hopper_top_z], [119, 99, 4], 5);
  difference() {
    rounded_box_at([-9, 1, hopper_top_z - 4], [108, 88, 5], 4);
    rounded_box_at([-6.5, 3.5, hopper_top_z - 5], [103, 83, 7], 3.5);
  }
}

module servo_bracket() {
  difference() {
    union() {
      // Perimeter frame shares the four main M3 fasteners with the base.
      difference() {
        rounded_box_at([0, 0, -4], [90, 90, 4], 4);
        rounded_box_at([11, 11, -5], [68, 68, 6], 3);
      }

      // Bridges suspend the offset SG90 cradle below the shaft axis.
      translate([8, 35, -4]) cube([31, 20, 4]);
      translate([62.4, 35, -4]) cube([19.6, 20, 4]);
    }

    cover_holes(-5, 7);

    // Servo body passes through from below. The offset follows the real SG90
    // shaft/body relationship; 0.6-1.0 mm total clearance covers common clones.
    translate([39, 38.4, -5]) cube([23.4, 13.2, 6]);

    // Ear slots accept M2 screws and tolerate clone-to-clone hole spacing.
    for (x = [36.5, 64.2])
      hull() {
        translate([x - 1.2, axis_y, -5]) cylinder(d = 2.2, h = 6);
        translate([x + 1.2, axis_y, -5]) cylinder(d = 2.2, h = 6);
      }
  }
}

module outlet_chute() {
  difference() {
    union() {
      // Shoulder sits against the bottom of the base.
      translate([drop_x, drop_y, -3]) cylinder(d = 30, h = 3);
      // Spigot has 0.4 mm radial clearance in the 27 mm outlet.
      translate([drop_x, drop_y, 0]) cylinder(d = 26.2, h = 2.8);
      // Short taper directs pellets clear of the mechanism.
      translate([drop_x, drop_y, -25]) cylinder(d1 = 20, d2 = 28, h = 22);
    }
    translate([drop_x, drop_y, -26]) cylinder(d1 = 14, d2 = 20, h = 30);
  }
}

module sg90_preview() {
  // Nominal reference only; excluded from exported STL files.
  color("#2457a7") translate([39.2, 38.75, -28]) cube([22.8, 12.5, 24]);
  color("#2457a7") translate([34, 37.5, -7]) cube([33, 15, 2.5]);
  color("white") translate([axis_x, axis_y, -4]) cylinder(d = 12, h = 7);
}

module assembly() {
  color("#4d5960") base_body();
  color("#d88742") rotor();
  color("#82a89f", 0.88) hopper();
  color("#a9c1ba", 0.9) lid();
  color("#2f3438") servo_bracket();
  color("#2f3438") outlet_chute();
  sg90_preview();
}

// Support-friendly STL orientations while preserving assembly coordinates.
module rotor_print() {
  translate([-axis_x + rotor_r, axis_y + rotor_r, rotor_z + rotor_t])
    rotate([180, 0, 0]) rotor();
}

module hopper_print() {
  translate([12.5, 2.5, -base_h]) hopper();
}

module lid_print() {
  translate([14.5, 4.5 + 2 * axis_y, hopper_top_z + 4])
    rotate([180, 0, 0]) lid();
}

module servo_bracket_print() {
  translate([0, 0, 4]) servo_bracket();
}

module chute_print() {
  translate([-drop_x + 15, -drop_y + 15, 25]) outlet_chute();
}

if (part == "base") base_body();
else if (part == "rotor") rotor_print();
else if (part == "hopper") hopper_print();
else if (part == "lid") lid_print();
else if (part == "servo_bracket") servo_bracket_print();
else if (part == "outlet_chute") chute_print();
else assembly();
