# %%
import json
import numpy as np
import pandas as pd
import cv2


source_file = "Default.ady"
target_file = "Linear_{}.ady"
compensation_files = {
    0: "front.png",
    1: "front.png",
    2: "surround.png",
    3: "surround.png",
    4: "top_front.png",
    5: "top_front.png",
    6: "top_rear.png",
    7: "top_rear.png",
    8: "subwoofer.png",
}

min_freq = 20  # Minimum frequency in Hz
max_freq = 20000  # Maximum frequency in Hz
resolution = 10  # Step size
zero_point = 1000
lf_cutoff = 200  # Frequency below which to optionally keep rolloff
keep_lowend_rolloff = {
    0: False,
    1: False,
    2: False,
    3: False,
    4: True,
    5: True,
    6: True,
    7: True,
    8: False,
}
axis_values = {
    'freq_min': 20,
    'freq_max': 20000,
    'gain_min': -30,
    'gain_max': 20
}
sub_axis_values = {
    'freq_min': 20,
    'freq_max': 200,
    'gain_min': -30,
    'gain_max': 20
}
curve_color_hsv = {
    'lower': np.array([0, 150, 150]),
    'upper': np.array([30, 255, 255])
}

slopes = [0.6]

with open(source_file, "r") as file:
    data = json.load(file)
# %%
def extract_curve_data(image_path, is_subwoofer):
    """
    Loads an image, isolates the curve, and extracts frequency/gain data.
    """
    try:
        img = cv2.imread(image_path)
        if img is None:
            print(f"Error: Could not open or find the image at '{image_path}'")
            return None

        graph = img
        graph_height, graph_width, _ = graph.shape
        hsv = cv2.cvtColor(graph, cv2.COLOR_BGR2HSV)
        mask = cv2.inRange(hsv, curve_color_hsv['lower'], curve_color_hsv['upper'])

        pixel_points = []
        for x in range(graph_width):
            y_coords = np.where(mask[:, x] > 0)[0]
            if y_coords.size > 0:
                y_avg = int(np.mean(y_coords))
                pixel_points.append((x, y_avg))

        if not pixel_points:
            print("Error: No curve could be detected with the current color settings.")
            return None

        ax_vals = sub_axis_values if is_subwoofer else axis_values

        log_freq_range = np.logspace(
            np.log10(ax_vals['freq_min']),
            np.log10(ax_vals['freq_max']),
            num=graph_width
        )

        frequencies = [log_freq_range[x] for x, y in pixel_points]
        gains = [np.interp(y, [0, graph_height - 1], [ax_vals['gain_max'], ax_vals['gain_min']]) for x, y in pixel_points]

        df = pd.DataFrame({'frequency': frequencies, 'gain': gains})
        return df

    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        return None


low_frequencies = np.arange(min_freq, lf_cutoff, 1)
mid_high_frequencies = np.arange(lf_cutoff, max_freq, resolution)
frequencies = np.concat([low_frequencies, mid_high_frequencies]) 
if frequencies[-1] != max_freq:
    frequencies = np.append(frequencies, max_freq)

for slope in slopes:
    for channel, compensation_file in compensation_files.items():
        extracted_df = extract_curve_data(compensation_file, is_subwoofer=("subwoofer" in compensation_file))
        interpolated_gains = np.interp(
            x=np.log10(frequencies),
            xp=np.log10(extracted_df['frequency']),
            fp=extracted_df['gain']
        )
        comp_df = pd.DataFrame({
            'frequency': frequencies,
            'gain': interpolated_gains
        })
        comp_gains = comp_df["gain"].values
        if keep_lowend_rolloff[channel]:
            mask = frequencies < zero_point
            comp_gains[mask] = 0
        gains = np.log2(zero_point / frequencies) * slope - comp_gains
        target_curve = [
            f"{{{freq:.1f}, {gain:.3f}}}" for freq, gain in zip(frequencies, gains)
        ]
        data["detectedChannels"][channel]["customTargetCurvePoints"] = target_curve

    out_file = target_file.format(f"{slope:.1f}".replace(".", "_"))
    with open(out_file, "w") as file:
        json.dump(data, file)
# %%
