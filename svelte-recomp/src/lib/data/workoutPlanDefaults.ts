// Default badminton-aware gym plan (see conversation for rationale):
// heavy lower/upper lifting days kept far from Wed/Fri NTC badminton
// nights (which serve as the primary fat-loss cardio), Thursday active
// recovery, Saturday lighter full-body hypertrophy, Sunday total rest.
// Used to auto-seed a new user's workout_schedule/workout_sessions_custom
// tables the first time they open the Workouts page (mirrors the pattern
// used for seeding the evening checklist). Fully editable afterwards.

export interface PlanExercise {
  phase: string; name: string; muscle: string; w1: string; w2: string;
  rest: string; tip: string; vid?: string;
}

export interface PlanSession {
  key: string; name: string; duration: string; focus: string;
  exercises: PlanExercise[];
}

export interface PlanDay {
  day_of_week: number; label: string; session_key: string | null; note: string;
}

export const DEFAULT_SESSIONS: PlanSession[] = [
  {
    "key": "lower",
    "name": "Heavy Lower Body \u2014 Quad & Hinge",
    "duration": "~55 min",
    "focus": "Quads, hamstrings, glutes \u2014 kept clear of your Wed/Fri badminton legs",
    "exercises": [
      {
        "phase": "Warm-Up (10 min)",
        "name": "World's Greatest Stretch",
        "muscle": "Hips \u00b7 Mobility",
        "w1": "5 reps/side",
        "w2": "5 reps/side",
        "rest": "\u2014",
        "tip": "Synovial fluid production, not strength work. Continuous nasal breathing, don't spike heart rate."
      },
      {
        "phase": "Warm-Up (10 min)",
        "name": "90/90 Hip Transfers",
        "muscle": "Hips \u00b7 Mobility",
        "w1": "10 reps",
        "w2": "10 reps",
        "rest": "\u2014",
        "tip": "Slow, controlled rotation through both hip sockets."
      },
      {
        "phase": "Warm-Up (10 min)",
        "name": "Bodyweight Glute Bridge",
        "muscle": "Glutes",
        "w1": "2 \u00d7 15",
        "w2": "2 \u00d7 15",
        "rest": "\u2014",
        "tip": "Squeeze glutes hard at the top for 1 second."
      },
      {
        "phase": "Primary Compound",
        "name": "Goblet Squat",
        "muscle": "Quads \u00b7 Glutes",
        "w1": "4 \u00d7 6-8",
        "w2": "4 \u00d7 6-8 (+5 kg)",
        "rest": "120-150s",
        "tip": "3s down (eccentric), 1s pause at bottom, explode up. Inhale into stomach and brace before descent, hold through the bottom, exhale forcefully as you push up. Do not rush rest \u2014 your CNS needs it.",
        "vid": "dM_Vx1p2wS4"
      },
      {
        "phase": "Secondary Hinge",
        "name": "Romanian Deadlift",
        "muscle": "Hamstrings \u00b7 Glutes",
        "w1": "3 \u00d7 8-10",
        "w2": "3 \u00d7 8-10 (+5 kg)",
        "rest": "90-120s",
        "tip": "Soft knees, push hips back until deep hamstring stretch, weights scrape the legs. Brace before descent, inhale down, exhale powerfully pulling hips forward.",
        "vid": "_dQ3HXSsGrs"
      },
      {
        "phase": "Hypertrophy Accessories",
        "name": "Leg Extension (superset w/ Calf Raise)",
        "muscle": "Quads \u00b7 Calves",
        "w1": "3 \u00d7 12-15",
        "w2": "3 \u00d7 12-15",
        "rest": "60s",
        "tip": "Controlled, continuous tension \u2014 no pausing at the bottom. Rhythmic breathing: inhale yielding, exhale contracting."
      },
      {
        "phase": "Cool Down (5 min)",
        "name": "Dead Hang",
        "muscle": "Spine decompression",
        "w1": "3 \u00d7 20s",
        "w2": "3 \u00d7 20s",
        "rest": "\u2014",
        "tip": "Decompress the spine after loading it."
      },
      {
        "phase": "Cool Down (5 min)",
        "name": "Child's Pose + Box Breathing",
        "muscle": "Recovery",
        "w1": "2 min",
        "w2": "2 min",
        "rest": "\u2014",
        "tip": "4s in, 4s hold, 4s out, 4s hold \u2014 shift to parasympathetic (rest/digest) state."
      }
    ]
  },
  {
    "key": "upper",
    "name": "Heavy Upper Body \u2014 Push & Pull",
    "duration": "~55 min",
    "focus": "Chest, back, shoulders, arms \u2014 same 5-phase structure, upper compounds",
    "exercises": [
      {
        "phase": "Warm-Up (10 min)",
        "name": "Band Pull-Apart",
        "muscle": "Rear delts \u00b7 Scapular control",
        "w1": "2 \u00d7 15",
        "w2": "2 \u00d7 15",
        "rest": "\u2014",
        "tip": "Nasal breathing only, elevate core temp without spiking heart rate."
      },
      {
        "phase": "Warm-Up (10 min)",
        "name": "Arm Circles + Shoulder Dislocates",
        "muscle": "Shoulders \u00b7 Mobility",
        "w1": "10 reps each",
        "w2": "10 reps each",
        "rest": "\u2014",
        "tip": "Full range, controlled \u2014 prep the joint before loading it."
      },
      {
        "phase": "Warm-Up (10 min)",
        "name": "Scap Push-Up",
        "muscle": "Serratus \u00b7 Shoulder health",
        "w1": "2 \u00d7 12",
        "w2": "2 \u00d7 12",
        "rest": "\u2014",
        "tip": "Protract/retract shoulder blades only, elbows locked."
      },
      {
        "phase": "Primary Compound",
        "name": "Bench Press",
        "muscle": "Chest \u00b7 Front Delts \u00b7 Triceps",
        "w1": "4 \u00d7 6-8",
        "w2": "4 \u00d7 6-8 (+2.5 kg)",
        "rest": "120-150s",
        "tip": "3s down, 1s pause on chest, explode up. Brace core, inhale on descent, exhale forcefully on the press.",
        "vid": "8iP2SOTJ0cY"
      },
      {
        "phase": "Secondary Push",
        "name": "Overhead Press",
        "muscle": "Shoulders \u00b7 Triceps",
        "w1": "3 \u00d7 8-10",
        "w2": "3 \u00d7 8-10 (+2 kg)",
        "rest": "90-120s",
        "tip": "Brace hard before unracking. Inhale at the bottom, exhale powerfully locking out overhead.",
        "vid": "qE0K6AtA0wM"
      },
      {
        "phase": "Hypertrophy Accessories",
        "name": "Barbell/Cable Row (superset w/ Curl + Pushdown)",
        "muscle": "Back \u00b7 Biceps \u00b7 Triceps",
        "w1": "3 \u00d7 12-15",
        "w2": "3 \u00d7 12-15",
        "rest": "60s",
        "tip": "Controlled, continuous tension, no momentum. Rhythmic breathing throughout.",
        "vid": "GZbfasYl4Ik"
      },
      {
        "phase": "Cool Down (5 min)",
        "name": "Dead Hang",
        "muscle": "Spine decompression",
        "w1": "3 \u00d7 20s",
        "w2": "3 \u00d7 20s",
        "rest": "\u2014",
        "tip": "Decompress the spine and shoulders after loading them."
      },
      {
        "phase": "Cool Down (5 min)",
        "name": "Child's Pose + Box Breathing",
        "muscle": "Recovery",
        "w1": "2 min",
        "w2": "2 min",
        "rest": "\u2014",
        "tip": "4-4-4-4 box breathing to shift into recovery mode."
      }
    ]
  },
  {
    "key": "fullbody",
    "name": "Full Body Hypertrophy \u2014 Lighter Volume",
    "duration": "~40 min",
    "focus": "Lighter compound volume \u2014 Saturday, still clear of Sunday's total rest",
    "exercises": [
      {
        "phase": "Warm-Up (8 min)",
        "name": "World's Greatest Stretch + Arm Circles",
        "muscle": "Full body mobility",
        "w1": "5 reps/side",
        "w2": "5 reps/side",
        "rest": "\u2014",
        "tip": "Shorter warm-up since loads are lighter today."
      },
      {
        "phase": "Primary Compound (Lighter)",
        "name": "Goblet Squat",
        "muscle": "Quads \u00b7 Glutes",
        "w1": "3 \u00d7 10",
        "w2": "3 \u00d7 10",
        "rest": "90s",
        "tip": "Same tempo cues as Monday, but lighter load \u2014 this is volume, not a max effort day.",
        "vid": "dM_Vx1p2wS4"
      },
      {
        "phase": "Primary Compound (Lighter)",
        "name": "Incline Dumbbell Press",
        "muscle": "Chest \u00b7 Shoulders",
        "w1": "3 \u00d7 10",
        "w2": "3 \u00d7 10",
        "rest": "90s",
        "tip": "Controlled tempo, full stretch at the bottom.",
        "vid": "8iP2SOTJ0cY"
      },
      {
        "phase": "Hypertrophy Accessories",
        "name": "Lat Pulldown + Lateral Raise (superset)",
        "muscle": "Back \u00b7 Shoulders",
        "w1": "3 \u00d7 15",
        "w2": "3 \u00d7 15",
        "rest": "60s",
        "tip": "Continuous tension, light-moderate weight, focus on the mind-muscle connection.",
        "vid": "lueEJGjTuqo"
      },
      {
        "phase": "Cool Down (5 min)",
        "name": "Child's Pose + Box Breathing",
        "muscle": "Recovery",
        "w1": "2 min",
        "w2": "2 min",
        "rest": "\u2014",
        "tip": "Wind down ahead of Sunday's full rest day."
      }
    ]
  }
];

export const DEFAULT_SCHEDULE: PlanDay[] = [
  {
    "day_of_week": 0,
    "label": "Total Rest",
    "session_key": null,
    "note": "Meal prep (Cosori/Instant Pot batches) & recovery"
  },
  {
    "day_of_week": 1,
    "label": "Heavy Lower Body",
    "session_key": "lower",
    "note": "Quad & Hinge focus \u2014 kept clear of Wed/Fri badminton"
  },
  {
    "day_of_week": 2,
    "label": "Heavy Upper Body",
    "session_key": "upper",
    "note": "Push & Pull focus"
  },
  {
    "day_of_week": 3,
    "label": "Cardio & Agility",
    "session_key": null,
    "note": "\ud83c\udff8 Badminton \u2014 NTC, 7:00\u20139:00 PM (this IS your fat-loss cardio)"
  },
  {
    "day_of_week": 4,
    "label": "Active Recovery",
    "session_key": null,
    "note": "45-minute light walk"
  },
  {
    "day_of_week": 5,
    "label": "Cardio & Agility",
    "session_key": null,
    "note": "\ud83c\udff8 Badminton \u2014 NTC, 7:00\u20139:00 PM"
  },
  {
    "day_of_week": 6,
    "label": "Full Body Hypertrophy",
    "session_key": "fullbody",
    "note": "Lighter compound volume"
  }
];
