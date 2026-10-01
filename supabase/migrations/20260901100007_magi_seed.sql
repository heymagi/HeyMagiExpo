/*
  MAGI — seed data.  GENERATED FILE: run `python3 tools/generate_seed.py` to regenerate.

  Sources:
    magi/data/trackable-signals.json  (31 signals, from the MAGI starter data framework)
    magi/data/intents.json            (80 intents, distilled from the training dataset)
    magi/data/challenges.json         (36 challenges, authored for this build)

  Embeddings are NOT seeded here — vectors do not belong in version-controlled SQL. Run
  `npm run embed:intents` against the target project after applying migrations; it fills
  scenario_intent.embedding and is idempotent.

  All three tables are reference data: readable by any authenticated user, writable only
  by the service role. ON CONFLICT DO UPDATE so re-running is safe.
*/

-- ============================================================
-- TRACKABLE SIGNALS
-- ============================================================

INSERT INTO signal_definition
  (id, label, category, subcategory, value_type, scale_min, scale_max, unit,
   privacy_level, clinical_standard, display_order, offer_early)
VALUES
  ('cycle_length_days', 'Cycle Length (Days)', 'Hormones and Cycle', 'Menstrual Cycle', 'numeric'::signal_value_type, NULL, NULL, NULL, 'high', 'Yes (ICD-11)', 10, true),
  ('hot_flush_frequency', 'Hot Flush Frequency', 'Hormones and Cycle', 'Menopause Symptoms', 'numeric'::signal_value_type, NULL, NULL, NULL, 'high', 'Partial (ICD-11)', 11, true),
  ('task_initiation_difficulty', 'Task Initiation Difficulty', 'Neurodivergence Specific', 'Executive Function', 'scale'::signal_value_type, 1, 5, NULL, 'medium', NULL, 12, true),
  ('overwhelm_from_crowds', 'Overwhelm from Crowds', 'Neurodivergence Specific', 'Sensory Overload', 'scale'::signal_value_type, 1, 5, NULL, 'high', NULL, 13, true),
  ('daily_mood_rating', 'Daily Mood Rating', 'Mental Health', 'Mood', 'scale'::signal_value_type, 1, 10, NULL, 'high', 'Partial (ICD-11)', 14, true),
  ('emotional_exhaustion_rating', 'Emotional Exhaustion Rating', 'Mental Health', 'Burnout', 'scale'::signal_value_type, 1, 10, NULL, 'high', NULL, 15, true),
  ('diagnosed_conditions', 'Diagnosed Conditions', 'Physical Health', 'Chronic Conditions', 'set'::signal_value_type, NULL, NULL, NULL, 'high', 'Yes (SNOMED)', 16, true),
  ('pain_score_0_10', 'Pain Score (0-10)', 'Physical Health', 'Pain Levels', 'numeric'::signal_value_type, NULL, NULL, NULL, 'high', 'Partial (Pain Scales)', 17, true),
  ('daily_fruit_veg_intake', 'Daily Fruit/Veg Intake', 'Lifestyle', 'Nutrition', 'numeric'::signal_value_type, NULL, NULL, NULL, 'low', NULL, 68, false),
  ('daily_steps', 'Daily Steps', 'Lifestyle', 'Movement', 'numeric'::signal_value_type, NULL, NULL, NULL, 'low', NULL, 69, false),
  ('sleep_duration_hours', 'Sleep Duration (Hours)', 'Sleep', 'Sleep Quality', 'numeric'::signal_value_type, NULL, NULL, NULL, 'medium', 'Partial (Sleep Studies)', 20, true),
  ('sleep_disruptions_per_night', 'Sleep Disruptions per Night', 'Sleep', 'Sleep Disruptions', 'numeric'::signal_value_type, NULL, NULL, NULL, 'medium', 'Partial (Sleep Studies)', 21, true),
  ('anger_spike_occurrence', 'Anger Spike Occurrence', 'Emotions', 'Anger Spikes', 'boolean'::signal_value_type, NULL, NULL, NULL, 'medium', NULL, 72, false),
  ('joy_burst_occurrence', 'Joy Burst Occurrence', 'Emotions', 'Joy Bursts', 'boolean'::signal_value_type, NULL, NULL, NULL, 'medium', NULL, 73, false),
  ('level_of_money_anxiety', 'Level of Money Anxiety', 'Financial Health', 'Money Anxiety', 'scale'::signal_value_type, 1, 5, NULL, 'high', NULL, 74, false),
  ('progress_towards_goal', 'Progress Towards Goal (%)', 'Financial Health', 'Financial Independence Goals', 'numeric'::signal_value_type, 0, 100, NULL, 'medium', NULL, 105, false),
  ('feeling_of_loneliness_1_5', 'Feeling of Loneliness (1-5)', 'Social and Relationships', 'Loneliness', 'scale'::signal_value_type, 1, 5, NULL, 'high', NULL, 76, false),
  ('support_quality_1_5', 'Support Quality (1-5)', 'Social and Relationships', 'Support System', 'scale'::signal_value_type, 1, 5, NULL, 'medium', NULL, 107, false),
  ('sensitivity_to_loud_sounds', 'Sensitivity to Loud Sounds', 'Environmental Triggers', 'Noise Sensitivity', 'scale'::signal_value_type, 1, 5, NULL, 'medium', NULL, 78, false),
  ('sensitivity_to_bright_lights', 'Sensitivity to Bright Lights', 'Environmental Triggers', 'Light Sensitivity', 'scale'::signal_value_type, 1, 5, NULL, 'medium', NULL, 79, false),
  ('difficulty_making_decisions', 'Difficulty Making Decisions', 'Cognitive Load', 'Decision Fatigue', 'scale'::signal_value_type, 1, 5, NULL, 'high', NULL, 80, false),
  ('stress_from_task_switching', 'Stress from Task Switching', 'Cognitive Load', 'Task Switching Stress', 'scale'::signal_value_type, 1, 5, NULL, 'high', NULL, 111, false),
  ('daily_overwhelm_rating', 'Daily Overwhelm Rating', 'Custom MAGI Factors', 'Overwhelm Meter', 'scale'::signal_value_type, 1, 10, NULL, 'high', NULL, 32, true),
  ('nervous_system_load_self_rating', 'Nervous System Load Self-Rating', 'Custom MAGI Factors', 'Nervous System Load', 'scale'::signal_value_type, 1, 10, NULL, 'high', NULL, 33, true),
  ('working_memory_fluctuations', 'Working Memory Fluctuations', 'Hormones & Neurodivergence', 'Cognitive Function', 'scale'::signal_value_type, 1, 10, NULL, 'high', NULL, 54, false),
  ('pmdd_symptom_severity', 'PMDD Symptom Severity', 'Reproductive Health', 'PMDD', 'scale'::signal_value_type, 1, 10, NULL, 'high', 'Yes (ICD-10: N94.3)', 35, true),
  ('menstrual_irregularity', 'Menstrual Irregularity', 'Reproductive Health', 'PCOS', 'boolean'::signal_value_type, NULL, NULL, NULL, 'high', 'Yes (ICD-10: E28.2)', 56, false),
  ('pelvic_pain_frequency', 'Pelvic Pain Frequency', 'Reproductive Health', 'Endometriosis', 'scale'::signal_value_type, 1, 10, NULL, 'high', 'Yes (ICD-10: N80)', 57, false),
  ('workplace_stress_rating', 'Workplace Stress Rating', 'Social Determinants', 'Work & Employment', 'scale'::signal_value_type, 1, 10, NULL, 'medium', NULL, 59, false),
  ('current_pregnancy_status', 'Current Pregnancy Status', 'Reproductive Health', 'Pregnancy', 'boolean'::signal_value_type, NULL, NULL, NULL, 'high', 'Yes (ICD-10: Z34-Z39)', 60, false),
  ('postpartum_mood_rating', 'Postpartum Mood Rating', 'Reproductive Health', 'Postpartum', 'scale'::signal_value_type, 1, 10, NULL, 'high', 'Yes (ICD-10: F53)', 61, false)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category,
  subcategory = EXCLUDED.subcategory,
  value_type = EXCLUDED.value_type,
  scale_min = EXCLUDED.scale_min,
  scale_max = EXCLUDED.scale_max,
  privacy_level = EXCLUDED.privacy_level,
  clinical_standard = EXCLUDED.clinical_standard,
  display_order = EXCLUDED.display_order,
  offer_early = EXCLUDED.offer_early;

-- ============================================================
-- SCENARIO INTENTS
-- ============================================================
-- need_intensity is how much support to offer. It is NOT a risk level;
-- risk is assessed independently on every turn. See magi/risk.ts.

INSERT INTO scenario_intent
  (id, phrase, category, need_intensity, dbt_skill, tone, somatic)
VALUES
  ('i_can_t_concentrate_on_anything_today', 'I can''t concentrate on anything today', 'focus_attention', 2, 'Mindfulness-Observe', 'encouraging_educational', false),
  ('my_mind_is_racing_with_too_many_thoughts', 'My mind is racing with too many thoughts', 'focus_attention', 3, 'Mindfulness-Observe', 'validating_supportive', false),
  ('i_keep_getting_distracted_by_every_little_so', 'I keep getting distracted by every little sound', 'focus_attention', 2, 'Mindfulness-Participate', 'encouraging_educational', false),
  ('i_m_hyperfocusing', 'I''m hyperfocusing', 'focus_attention', 2, 'Mindfulness-Describe', 'encouraging_educational', false),
  ('my_attention_jumps_around_constantly', 'My attention jumps around constantly', 'focus_attention', 2, 'Mindfulness-Observe', 'encouraging_educational', false),
  ('i_can_t_follow_conversations_in_groups', 'I can''t follow conversations in groups', 'focus_attention', 2, 'Mindfulness-Participate', 'encouraging_educational', false),
  ('reading_feels_impossible_right_now', 'Reading feels impossible right now', 'focus_attention', 2, 'Mindfulness-Observe', 'encouraging_educational', false),
  ('i_lose_track_of_what_i_m_doing_mid_task', 'I lose track of what I''m doing mid-task', 'focus_attention', 2, 'Mindfulness-Describe', 'encouraging_educational', false),
  ('my_brain_feels_foggy', 'My brain feels foggy', 'focus_attention', 2, 'Mindfulness-Observe', 'encouraging_educational', false),
  ('i_can_t_filter_out_background_noise', 'I can''t filter out background noise', 'focus_attention', 2, 'Distress_Tolerance-ACCEPTS', 'encouraging_educational', false),
  ('i_m_feeling_overwhelmed_by_my_emotions', 'I''m feeling overwhelmed by my emotions', 'emotional_regulation', 3, 'Emotion_Regulation-PLEASE', 'validating_supportive', true),
  ('my_emotions_change_so_quickly', 'My emotions change so quickly', 'emotional_regulation', 3, 'Emotion_Regulation-Check_Facts', 'validating_supportive', true),
  ('i_m_so_angry', 'I''m so angry', 'emotional_regulation', 3, 'Emotion_Regulation-Check_Facts', 'validating_supportive', true),
  ('i_feel_like_i_m_going_to_explode_emotionally', 'I feel like I''m going to explode emotionally', 'emotional_regulation', 4, 'Distress_Tolerance-TIPP', 'crisis_supportive', true),
  ('i_can_t_stop_crying', 'I can''t stop crying', 'emotional_regulation', 3, 'Distress_Tolerance-ACCEPTS', 'validating_supportive', true),
  ('i_feel_numb', 'I feel numb', 'emotional_regulation', 2, 'Mindfulness-Observe', 'encouraging_educational', true),
  ('my_emotions_feel_too_big_for_my_body', 'My emotions feel too big for my body', 'emotional_regulation', 3, 'Distress_Tolerance-TIPP', 'validating_supportive', true),
  ('i_m_having_an_emotional_flashback', 'I''m having an emotional flashback', 'emotional_regulation', 4, 'Distress_Tolerance-Radical_Acceptance', 'crisis_supportive', true),
  ('i_feel_ashamed_of_my_emotional_reactions', 'I feel ashamed of my emotional reactions', 'emotional_regulation', 2, 'Emotion_Regulation-Check_Facts', 'encouraging_educational', true),
  ('i_m_stuck_in_a_negative_emotion_spiral', 'I''m stuck in a negative emotion spiral', 'emotional_regulation', 3, 'Emotion_Regulation-Opposite_Action', 'validating_supportive', true),
  ('i_m_having_a_panic_attack', 'I''m having a panic attack', 'crisis_support', 4, 'Distress_Tolerance-TIPP', 'crisis_supportive', true),
  ('i_feel_like_i_can_t_cope_anymore', 'I feel like I can''t cope anymore', 'crisis_support', 4, 'Distress_Tolerance-Radical_Acceptance', 'crisis_supportive', true),
  ('everything_feels_too_much_right_now', 'Everything feels too much right now', 'crisis_support', 4, 'Distress_Tolerance-ACCEPTS', 'crisis_supportive', true),
  ('i_m_having_thoughts_of_self_harm', 'I''m having thoughts of self-harm', 'crisis_support', 5, 'Distress_Tolerance-TIPP', 'crisis_supportive', true),
  ('i_m_in_complete_shutdown_mode', 'I''m in complete shutdown mode', 'crisis_support', 4, 'Distress_Tolerance-Radical_Acceptance', 'crisis_supportive', true),
  ('i_want_to_run_away_from_everything', 'I want to run away from everything', 'crisis_support', 4, 'Distress_Tolerance-ACCEPTS', 'crisis_supportive', true),
  ('i_m_having_a_complete_meltdown', 'I''m having a complete meltdown', 'crisis_support', 4, 'Distress_Tolerance-TIPP', 'crisis_supportive', true),
  ('i_feel_like_i_m_drowning_in_overwhelm', 'I feel like I''m drowning in overwhelm', 'crisis_support', 4, 'Distress_Tolerance-ACCEPTS', 'crisis_supportive', true),
  ('i_m_having_suicidal_thoughts', 'I''m having suicidal thoughts', 'crisis_support', 5, 'Distress_Tolerance-TIPP', 'crisis_supportive', true),
  ('i_can_t_breathe_properly_from_anxiety', 'I can''t breathe properly from anxiety', 'crisis_support', 4, 'Distress_Tolerance-TIPP', 'crisis_supportive', true),
  ('my_period_is_making_everything_harder', 'My period is making everything harder', 'hormone_impact', 3, 'Emotion_Regulation-PLEASE', 'validating_supportive', false),
  ('i_feel_crazy_during_pms', 'I feel crazy during PMS', 'hormone_impact', 3, 'Emotion_Regulation-Check_Facts', 'validating_supportive', false),
  ('my_adhd_symptoms_are_worse_during_my_cycle', 'My ADHD symptoms are worse during my cycle', 'hormone_impact', 3, 'Mindfulness-Observe', 'validating_supportive', false),
  ('my_medications_don_t_work_during_my_period', 'My medications don''t work during my period', 'hormone_impact', 3, 'Distress_Tolerance-ACCEPTS', 'validating_supportive', false),
  ('i_have_intense_mood_swings_before_my_period', 'I have intense mood swings before my period', 'hormone_impact', 3, 'Emotion_Regulation-Check_Facts', 'validating_supportive', false),
  ('my_hormones_make_me_feel_out_of_control', 'My hormones make me feel out of control', 'hormone_impact', 3, 'Emotion_Regulation-PLEASE', 'validating_supportive', false),
  ('i_have_pmdd', 'I have PMDD', 'hormone_impact', 4, 'Distress_Tolerance-Radical_Acceptance', 'crisis_supportive', false),
  ('ovulation_makes_me_hypersensitive', 'Ovulation makes me hypersensitive', 'hormone_impact', 2, 'Distress_Tolerance-ACCEPTS', 'encouraging_educational', false),
  ('perimenopause_is_affecting_my_brain_fog', 'Perimenopause is affecting my brain fog', 'hormone_impact', 2, 'Mindfulness-Describe', 'encouraging_educational', false),
  ('my_cycle_makes_my_autism_symptoms_worse', 'My cycle makes my autism symptoms worse', 'hormone_impact', 3, 'Distress_Tolerance-ACCEPTS', 'validating_supportive', false),
  ('i_don_t_know_how_to_ask_for_help', 'I don''t know how to ask for help', 'social_interpersonal', 2, 'Interpersonal-DEAR_MAN', 'encouraging_educational', false),
  ('i_feel_like_nobody_understands_me', 'I feel like nobody understands me', 'social_interpersonal', 3, 'Interpersonal-GIVE', 'validating_supportive', false),
  ('i_m_struggling_in_my_relationship', 'I''m struggling in my relationship', 'social_interpersonal', 3, 'Interpersonal-DEAR_MAN', 'validating_supportive', false),
  ('i_need_to_set_boundaries_but_don_t_know_how', 'I need to set boundaries but don''t know how', 'social_interpersonal', 2, 'Interpersonal-FAST', 'encouraging_educational', false),
  ('i_m_having_conflict_with_someone_important', 'I''m having conflict with someone important', 'social_interpersonal', 3, 'Interpersonal-GIVE', 'validating_supportive', false),
  ('i_feel_rejected', 'I feel rejected', 'social_interpersonal', 3, 'Distress_Tolerance-Radical_Acceptance', 'validating_supportive', false),
  ('i_m_struggling_to_communicate_my_needs', 'I''m struggling to communicate my needs', 'social_interpersonal', 2, 'Interpersonal-DEAR_MAN', 'encouraging_educational', false),
  ('people_don_t_believe_i_m_struggling', 'People don''t believe I''m struggling', 'social_interpersonal', 3, 'Interpersonal-FAST', 'validating_supportive', false),
  ('i_m_afraid_of_being_abandoned', 'I''m afraid of being abandoned', 'social_interpersonal', 3, 'Distress_Tolerance-Radical_Acceptance', 'validating_supportive', false),
  ('i_can_t_read_social_cues_properly', 'I can''t read social cues properly', 'social_interpersonal', 2, 'Mindfulness-Observe', 'encouraging_educational', false),
  ('everything_is_too_loud', 'Everything is too loud', 'sensory_overload', 4, 'Distress_Tolerance-TIPP', 'crisis_supportive', true),
  ('i_need_to_calm_my_body_down', 'I need to calm my body down', 'sensory_overload', 3, 'Distress_Tolerance-TIPP', 'validating_supportive', true),
  ('i_m_having_a_sensory_overload', 'I''m having a sensory overload', 'sensory_overload', 4, 'Distress_Tolerance-ACCEPTS', 'crisis_supportive', true),
  ('my_body_feels_disconnected', 'My body feels disconnected', 'sensory_overload', 2, 'Mindfulness-Observe', 'encouraging_educational', true),
  ('i_can_t_handle_any_more_stimulation', 'I can''t handle any more stimulation', 'sensory_overload', 4, 'Distress_Tolerance-ACCEPTS', 'crisis_supportive', true),
  ('textures_are_making_me_want_to_scream', 'Textures are making me want to scream', 'sensory_overload', 3, 'Distress_Tolerance-TIPP', 'validating_supportive', true),
  ('the_lights_are_hurting_my_eyes', 'The lights are hurting my eyes', 'sensory_overload', 2, 'Distress_Tolerance-ACCEPTS', 'encouraging_educational', true),
  ('i_need_help_grounding_myself', 'I need help grounding myself', 'sensory_overload', 2, 'Mindfulness-Participate', 'encouraging_educational', true),
  ('sounds_are_physically_painful_right_now', 'Sounds are physically painful right now', 'sensory_overload', 3, 'Distress_Tolerance-TIPP', 'validating_supportive', true),
  ('i_m_overwhelmed_by_smells', 'I''m overwhelmed by smells', 'sensory_overload', 2, 'Distress_Tolerance-ACCEPTS', 'encouraging_educational', true),
  ('i_can_t_make_decisions_today', 'I can''t make decisions today', 'executive_function', 2, 'Distress_Tolerance-Radical_Acceptance', 'encouraging_educational', false),
  ('i_m_procrastinating_on_important_tasks', 'I''m procrastinating on important tasks', 'executive_function', 2, 'Emotion_Regulation-Opposite_Action', 'encouraging_educational', false),
  ('i_feel_paralyzed', 'I feel paralyzed', 'executive_function', 3, 'Distress_Tolerance-ACCEPTS', 'validating_supportive', false),
  ('i_can_t_organize_my_thoughts', 'I can''t organize my thoughts', 'executive_function', 2, 'Mindfulness-Describe', 'encouraging_educational', false),
  ('time_management_feels_impossible', 'Time management feels impossible', 'executive_function', 2, 'Distress_Tolerance-ACCEPTS', 'encouraging_educational', false),
  ('i_need_accommodations_at_work', 'I need accommodations at work', 'work_school', 2, 'Interpersonal-DEAR_MAN', 'encouraging_educational', false),
  ('i_can_t_keep_up_with_coursework', 'I can''t keep up with coursework', 'work_school', 3, 'Distress_Tolerance-ACCEPTS', 'validating_supportive', false),
  ('my_boss_doesn_t_understand_my_needs', 'My boss doesn''t understand my needs', 'work_school', 3, 'Interpersonal-FAST', 'validating_supportive', false),
  ('i_m_struggling_with_deadlines', 'I''m struggling with deadlines', 'work_school', 3, 'Emotion_Regulation-PLEASE', 'validating_supportive', false),
  ('meetings_are_overwhelming_for_me', 'Meetings are overwhelming for me', 'work_school', 2, 'Distress_Tolerance-ACCEPTS', 'encouraging_educational', false),
  ('i_feel_like_i_m_failing_at_everything', 'I feel like I''m failing at everything', 'identity_masking', 3, 'Emotion_Regulation-Check_Facts', 'validating_supportive', false),
  ('i_don_t_know_who_i_am_without_my_mask', 'I don''t know who I am without my mask', 'identity_masking', 3, 'Mindfulness-Observe', 'validating_supportive', false),
  ('i_m_tired_of_pretending_i_m_okay', 'I''m tired of pretending I''m okay', 'identity_masking', 3, 'Interpersonal-FAST', 'validating_supportive', false),
  ('i_m_exhausted_from_masking_all_day', 'I''m exhausted from masking all day', 'identity_masking', 3, 'Distress_Tolerance-ACCEPTS', 'validating_supportive', false),
  ('i_want_to_stop_hiding_my_struggles', 'I want to stop hiding my struggles', 'identity_masking', 2, 'Interpersonal-DEAR_MAN', 'encouraging_educational', false),
  ('i_accomplished_something_important_today', 'I accomplished something important today', 'success_positive', 1, 'Mindfulness-Participate', 'positive_reinforcing', false),
  ('i_successfully_used_a_dbt_skill', 'I successfully used a DBT skill', 'success_positive', 1, 'Mindfulness-Describe', 'positive_reinforcing', false),
  ('i_m_feeling_proud_of_my_progress', 'I''m feeling proud of my progress', 'success_positive', 1, 'Mindfulness-Observe', 'positive_reinforcing', false),
  ('i_managed_a_difficult_situation_well', 'I managed a difficult situation well', 'success_positive', 1, 'Emotion_Regulation-Check_Facts', 'positive_reinforcing', false),
  ('i_advocated_for_myself_successfully', 'I advocated for myself successfully', 'success_positive', 1, 'Interpersonal-FAST', 'positive_reinforcing', false)
ON CONFLICT (id) DO UPDATE SET
  phrase = EXCLUDED.phrase,
  category = EXCLUDED.category,
  need_intensity = EXCLUDED.need_intensity,
  dbt_skill = EXCLUDED.dbt_skill,
  tone = EXCLUDED.tone,
  somatic = EXCLUDED.somatic;

-- ============================================================
-- CHALLENGE LIBRARY
-- ============================================================
-- No streak, consecutive-day or points column exists anywhere in this schema,
-- and none should be added: gamification is an explicit product non-goal.

INSERT INTO challenge_template
  (id, title, invitation, detail, category, dbt_skill, effort, minutes,
   sensory_load, low_capacity_safe, somatic, suits_neurotypes, min_age)
VALUES
  ('one_sip', 'One sip', 'Have a mouthful of water, whenever you next move.', 'Not a glass. A mouthful. Dehydration makes everything harder to think through and it is the easiest thing on this list to fix.', 'emotional_regulation', NULL, 1, 1, 1, true, true, '{}', 13),
  ('cold_water_wrists', 'Cold water on your wrists', 'Run cold water over the inside of your wrists for thirty seconds.', 'This is the fastest way to bring a spiked nervous system down without having to think or decide anything. Face works too, if you can.', 'crisis_support', 'Distress_Tolerance-TIPP', 1, 1, 1, true, true, '{}', 13),
  ('long_exhale', 'Longer out than in', 'Breathe in for four, out for eight. Six rounds.', 'The long exhale is the part that does the work. Counting is optional if counting is annoying today.', 'crisis_support', 'Distress_Tolerance-TIPP', 1, 2, 1, true, true, '{}', 13),
  ('weight_on_you', 'Something heavy on you', 'Put something with weight across your lap or chest for a few minutes.', 'A blanket, a cushion, a cat if one is available. Deep pressure tells the body it is contained.', 'sensory_overload', NULL, 1, 5, 1, true, true, ARRAY['Autism', 'Sensory Processing Disorder', 'ADHD-Autism']::text[], 13),
  ('lights_down', 'Take the lights down', 'Turn off the overhead light and use a lamp, or nothing at all.', 'Overhead light is the single most common unnoticed source of sensory load indoors.', 'sensory_overload', NULL, 1, 1, 1, true, false, ARRAY['Autism', 'Sensory Processing Disorder', 'ADHD-Autism', 'OCD-ADHD']::text[], 13),
  ('ears_off', 'Ears off for ten minutes', 'Put in ear defenders, loops or headphones with nothing playing.', 'Silence is a different thing from quiet music. Ten minutes of actual silence can reset a whole afternoon.', 'sensory_overload', NULL, 1, 10, 1, true, true, ARRAY['Autism', 'Sensory Processing Disorder', 'ADHD-Autism']::text[], 13),
  ('name_five', 'Name five things', 'Look around and name five things you can see. Out loud or in your head.', 'Not to fix anything. Just to put you back in the room you are actually in.', 'sensory_overload', 'Mindfulness-Observe', 1, 2, 1, true, true, '{}', 13),
  ('floor_time', 'Lie on the floor', 'Get on the floor for five minutes. That is the whole thing.', 'No stretching, no breathing exercise, no app. The floor holds you up so nothing else has to.', 'crisis_support', NULL, 1, 5, 1, true, true, '{}', 13),
  ('two_minute_start', 'Two minutes only', 'Set a timer for two minutes on the thing you are avoiding, and stop when it goes.', 'You are allowed to stop. The point is starting, and starting is the part that is actually hard.', 'executive_function', 'Emotion_Regulation-Opposite_Action', 2, 2, 1, false, false, ARRAY['ADHD-Inattentive', 'ADHD-Combined', 'ADHD-Hyperactive', 'Dyslexia-ADHD', 'OCD-ADHD']::text[], 13),
  ('body_double', 'Do it near someone', 'Do the task with another person in the room, or on a video call, doing their own thing.', 'Body doubling. Nobody has to talk or help. Presence alone does something that willpower does not.', 'executive_function', NULL, 2, 20, 2, false, false, ARRAY['ADHD-Inattentive', 'ADHD-Combined', 'ADHD-Hyperactive', 'PDA', 'Dyspraxia']::text[], 13),
  ('one_surface', 'One surface', 'Clear one surface. Not the room. One surface.', 'Pick the smallest one you can see. A visible finished thing is worth more than a plan.', 'executive_function', NULL, 2, 10, 2, false, false, ARRAY['ADHD-Inattentive', 'ADHD-Combined', 'Dyspraxia']::text[], 13),
  ('decide_by_coin', 'Let a coin decide', 'For the next low-stakes decision you are stuck on, flip for it.', 'When decision fatigue has set in, the cost of choosing badly is usually far lower than the cost of not choosing.', 'executive_function', 'Distress_Tolerance-Radical_Acceptance', 1, 1, 1, true, false, ARRAY['ADHD-Inattentive', 'ADHD-Combined', 'OCD-ADHD']::text[], 13),
  ('write_it_down_wherever', 'Write it anywhere', 'Put the thing you are trying not to forget somewhere outside your head. Anywhere.', 'Back of your hand, a voice note, a text to yourself. Working memory is not a storage system and pretending otherwise costs you all day.', 'focus_attention', 'Mindfulness-Describe', 1, 1, 1, true, false, ARRAY['ADHD-Inattentive', 'ADHD-Combined', 'Dyslexia-ADHD', 'Dyspraxia']::text[], 13),
  ('one_tab', 'Close all but one', 'Close every tab, window and app except the one you need.', 'Not for tidiness. Every open thing is a small pull on attention you are paying for without noticing.', 'focus_attention', NULL, 2, 3, 1, false, false, ARRAY['ADHD-Inattentive', 'ADHD-Combined', 'ADHD-Hyperactive']::text[], 13),
  ('walk_the_thought', 'Walk while you think', 'If a thought will not resolve sitting still, move while you have it.', 'Pacing counts. Some brains genuinely process better in motion, and sitting still to concentrate is advice written for other people.', 'focus_attention', NULL, 2, 10, 2, false, true, ARRAY['ADHD-Hyperactive', 'ADHD-Combined', 'ADHD-Inattentive']::text[], 13),
  ('hyperfocus_anchor', 'Set one anchor', 'Before you go in deep, set one alarm for something you must not miss.', 'Hyperfocus is not the problem. Losing the thing on the other side of it is.', 'focus_attention', NULL, 1, 1, 1, true, false, ARRAY['ADHD-Combined', 'ADHD-Hyperactive', 'Autism', 'ADHD-Autism']::text[], 13),
  ('flat_words', 'Say it flat', 'Describe what is happening in the most boring words you can find.', '"My chest is tight and my thoughts are fast" rather than "I am falling apart". Same facts, much less to carry.', 'emotional_regulation', 'Mindfulness-Describe', 2, 3, 1, true, false, '{}', 13),
  ('check_the_floor', 'Check the floor under it', 'Before anything else: have you eaten, drunk, slept, and taken what you take?', 'Not a telling-off. Four physical things account for a startling share of what feels like emotional collapse.', 'emotional_regulation', 'Emotion_Regulation-PLEASE', 1, 2, 1, true, true, '{}', 13),
  ('let_it_be_ninety', 'Ninety seconds', 'When the wave hits, set ninety seconds and just let it be there.', 'You do not have to do anything with it or about it. Most surges of feeling crest and start to drop in about that long.', 'emotional_regulation', 'Distress_Tolerance-Radical_Acceptance', 2, 2, 1, true, true, '{}', 13),
  ('shame_out_loud', 'Say the shame part', 'Say the bit you are most embarrassed about out loud, to yourself, once.', 'Shame gets most of its weight from being unsaid. This is not confession and nobody has to hear it.', 'identity_masking', 'Emotion_Regulation-Check_Facts', 3, 3, 1, true, false, '{}', 16),
  ('unmask_ten', 'Ten minutes unmasked', 'For ten minutes, drop the performance. Stim, slump, stare, script nothing.', 'Alone, door shut. Masking is genuine physical work and this is the only rest from it.', 'identity_masking', NULL, 1, 10, 1, true, true, ARRAY['Autism', 'ADHD-Autism', 'PDA', 'Sensory Processing Disorder']::text[], 13),
  ('one_true_thing', 'One true thing about today', 'Write one sentence about today that is true and not a judgement.', '"I got through a meeting I was dreading" counts. "I should have done more" does not — that is a verdict, not a fact.', 'identity_masking', 'Emotion_Regulation-Check_Facts', 2, 3, 1, true, false, '{}', 13),
  ('draft_the_ask', 'Draft the ask', 'Write the message you are dreading, and do not send it yet.', 'Writing it and sending it are two separate jobs. Doing the first one today makes the second one much smaller.', 'social_interpersonal', 'Interpersonal-DEAR_MAN', 3, 10, 1, false, false, '{}', 13),
  ('one_boundary_sentence', 'One sentence, no apology', 'Write your boundary as one sentence with no "sorry" and no explanation.', 'You can add the softening back afterwards if you want it. Start from the version that is just true.', 'social_interpersonal', 'Interpersonal-FAST', 3, 5, 1, false, false, ARRAY['PDA', 'Autism', 'ADHD-Autism']::text[], 16),
  ('tell_one_person', 'Tell one person a real thing', 'Tell one person one honest thing about how you actually are.', 'Not everyone. One. It can be small and it does not have to lead anywhere.', 'social_interpersonal', 'Interpersonal-GIVE', 3, 5, 2, false, false, '{}', 13),
  ('leave_early_plan', 'Decide your exit first', 'Before the social thing, decide when you are leaving and how.', 'Having an exit makes it possible to be there at all. Deciding it in advance means not negotiating with yourself while depleted.', 'social_interpersonal', NULL, 2, 5, 1, true, false, ARRAY['Autism', 'ADHD-Autism', 'Sensory Processing Disorder', 'PDA']::text[], 13),
  ('phase_note', 'Note where you are in the month', 'Log roughly where you are in your cycle, alongside how today felt.', 'A few weeks of this and the pattern usually becomes obvious. Until then it just looks like being unreliable.', 'hormone_impact', NULL, 1, 1, 1, true, false, '{}', 13),
  ('lower_the_bar_deliberately', 'Lower the bar on purpose', 'Pick one thing this week that gets the minimum version, decided in advance.', 'Choosing where to do less is different from running out of capacity and failing at everything at once.', 'hormone_impact', 'Distress_Tolerance-Radical_Acceptance', 2, 5, 1, true, false, '{}', 13),
  ('pain_before_mood', 'Check pain before mood', 'Before you decide how you feel, rate any physical pain out of ten.', 'Persistent low-level pain reliably reads as low mood or irritability, and it is treated very differently.', 'hormone_impact', 'Emotion_Regulation-PLEASE', 1, 2, 1, true, true, '{}', 13),
  ('three_bullets_for_gp', 'Three bullets for the appointment', 'Write the three things you must say, in order, before you go.', 'Under pressure the important one is the one that goes missing. On paper it cannot.', 'work_school', NULL, 2, 10, 1, false, false, '{}', 13),
  ('one_accommodation', 'Name one adjustment', 'Name one specific thing that would make work or study easier. Just name it.', '"A written summary after meetings" is askable. "More support" is not. Naming it is most of the work.', 'work_school', 'Interpersonal-DEAR_MAN', 2, 10, 1, false, false, '{}', 16),
  ('meeting_recovery', 'Book the recovery, not just the meeting', 'Put ten empty minutes in the diary straight after the demanding thing.', 'The cost of the meeting is not the meeting. It is the hour afterwards you had already promised to something else.', 'work_school', NULL, 2, 5, 1, true, false, ARRAY['Autism', 'ADHD-Autism', 'Sensory Processing Disorder', 'ADHD-Combined']::text[], 16),
  ('deadline_out_loud', 'Say the deadline to someone', 'Tell one person what you are doing and by when.', 'External structure does what internal intention cannot, and this is the cheapest version of it.', 'work_school', NULL, 2, 3, 1, false, false, ARRAY['ADHD-Inattentive', 'ADHD-Combined', 'ADHD-Hyperactive']::text[], 13),
  ('note_what_worked', 'Note what worked', 'Write down the thing that helped today, so you have it next time.', 'You will not remember. Everyone assumes they will and nobody does.', 'success_positive', 'Mindfulness-Describe', 1, 2, 1, true, false, '{}', 13),
  ('credit_yourself', 'Take the credit', 'Say what you did today and leave out the word "just".', '"I just replied to some emails" and "I replied to some emails" describe the same day very differently.', 'success_positive', 'Emotion_Regulation-Check_Facts', 1, 2, 1, true, false, '{}', 13),
  ('absorb_in_one_thing', 'Get absorbed in one thing', 'Do one thing you like for its own sake, without checking how it is going.', 'Not productive, not measured, not posted. The point is being in it.', 'success_positive', 'Mindfulness-Participate', 1, 20, 2, true, false, '{}', 13)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  invitation = EXCLUDED.invitation,
  detail = EXCLUDED.detail,
  category = EXCLUDED.category,
  dbt_skill = EXCLUDED.dbt_skill,
  effort = EXCLUDED.effort,
  minutes = EXCLUDED.minutes,
  sensory_load = EXCLUDED.sensory_load,
  low_capacity_safe = EXCLUDED.low_capacity_safe,
  somatic = EXCLUDED.somatic,
  suits_neurotypes = EXCLUDED.suits_neurotypes,
  min_age = EXCLUDED.min_age;
