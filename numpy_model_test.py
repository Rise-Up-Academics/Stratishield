import numpy as np
import matplotlib.pyplot as plt


# ---------------------------------------------------------
# RANDOM SEED
# ---------------------------------------------------------

# Keeps the random data the same each time the program runs
np.random.seed(42)


# ---------------------------------------------------------
# HISTOGRAM DATA
# ---------------------------------------------------------

hisData = np.random.normal(
    0.0,
    100.0,
    100000
)

hisMean = np.mean(hisData)
hisMedian = np.median(hisData)
hisStd = np.std(hisData)
hisVar = np.var(hisData)

hisPercentile = np.percentile(
    hisData,
    75
)


print("\n--- Histogram Statistics ---")

print(
    "Mean:",
    np.round(hisMean, 2)
)

print(
    "Median:",
    np.round(hisMedian, 2)
)

print(
    "Standard Deviation:",
    np.round(hisStd, 2)
)

print(
    "Variance:",
    np.round(hisVar, 2)
)

print(
    "75th Percentile:",
    np.round(hisPercentile, 2)
)


# ---------------------------------------------------------
# ORIGINAL SCATTER DATA
# ---------------------------------------------------------

scatterDataA = np.random.normal(
    5.0,
    1.0,
    1000
)

scatterDataB = np.random.normal(
    10.0,
    2.0,
    1000
)


# ---------------------------------------------------------
# CORRELATION
# ---------------------------------------------------------

correlation = np.corrcoef(
    scatterDataA,
    scatterDataB
)[0, 1]

print(
    "\nCorrelation between scatter datasets:",
    np.round(correlation, 3)
)


# ---------------------------------------------------------
# LABELED TRAINING DATA
# ---------------------------------------------------------

# Class 0
class0_x = np.random.normal(
    4.0,
    1.0,
    500
)

class0_y = np.random.normal(
    8.0,
    1.5,
    500
)


# Class 1
class1_x = np.random.normal(
    7.0,
    1.0,
    500
)

class1_y = np.random.normal(
    12.0,
    1.5,
    500
)


# ---------------------------------------------------------
# COMBINE LABELED DATA
# ---------------------------------------------------------

# Each row contains two features
class0_data = np.column_stack(
    (
        class0_x,
        class0_y
    )
)

class1_data = np.column_stack(
    (
        class1_x,
        class1_y
    )
)


# X contains the input data
X = np.vstack(
    (
        class0_data,
        class1_data
    )
)


# y contains the labels
# 0 = Class 0
# 1 = Class 1
y = np.concatenate(
    (
        np.zeros(500),
        np.ones(500)
    )
)


print(
    "\nTotal labeled samples:",
    len(X)
)

print(
    "Class 0 samples:",
    np.sum(y == 0)
)

print(
    "Class 1 samples:",
    np.sum(y == 1)
)


# ---------------------------------------------------------
# PLOTTING
# ---------------------------------------------------------

fig, (ax1, ax2, ax3) = plt.subplots(
    1,
    3,
    figsize=(18, 5)
)


# ---------------------------------------------------------
# CREATE PLOT FUNCTION
# ---------------------------------------------------------

def createPlot(
    axe,
    plot_type,
    data1,
    data2=None,
    bins=50
):

    if plot_type == "hist":

        axe.hist(
            data1,
            bins=bins,
            edgecolor="black"
        )

    elif plot_type == "scatter":

        axe.scatter(
            data1,
            data2,
            alpha=0.5
        )

    axe.set_title(
        input(
            "What should the title be?: "
        )
    )

    axe.set_xlabel(
        input(
            "What is the x axis name?: "
        )
    )

    axe.set_ylabel(
        input(
            "What is the y axis name?: "
        )
    )


# ---------------------------------------------------------
# HISTOGRAM
# ---------------------------------------------------------

print(
    "\n--- Configure Histogram ---"
)

createPlot(
    ax1,
    "hist",
    hisData,
    bins=50
)


# ---------------------------------------------------------
# ORIGINAL SCATTER PLOT
# ---------------------------------------------------------

print(
    "\n--- Configure Scatter Plot ---"
)

createPlot(
    ax2,
    "scatter",
    scatterDataA,
    scatterDataB
)


# ---------------------------------------------------------
# LABELED DATA SCATTER PLOT
# ---------------------------------------------------------

ax3.scatter(
    class0_x,
    class0_y,
    alpha=0.5,
    label="Class 0"
)

ax3.scatter(
    class1_x,
    class1_y,
    alpha=0.5,
    label="Class 1"
)

ax3.set_title(
    "Labeled Training Data"
)

ax3.set_xlabel(
    "Feature 1"
)

ax3.set_ylabel(
    "Feature 2"
)

ax3.legend()


# ---------------------------------------------------------
# DISPLAY
# ---------------------------------------------------------

plt.tight_layout()
plt.show()
