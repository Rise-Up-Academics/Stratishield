"""
THIS FILE IS EXPLICITLY FOR PRACTICE. NOT APART OF THE PROGRAM OF INBOX OS. DO NOT UTILIZE, CHANGE, OR ALTER THIS FILE FOR NON-PRACTICE PURPOSES.
"""
import random

import numpy as np
import matplotlib.pyplot as plt
from scipy import stats


# -------------------------------------------------------------------------------
# HISTOGRAM
# -------------------------------------------------------------------------------
hisData = np.random.normal(0.0, 100.0, 100000)

hisStd = np.std(hisData)
hisVar = np.var(hisData)

hisPercentile = np.percentile(hisData, 75)

print("The Dataset given has a standard deviation of ", np.round(hisStd), ", a variance of ", np.round(hisVar), f", with 75% of hisData in it being", np.round(hisPercentile), "or less")


# -------------------------------------------------------------------------------
# SCATTER
# -------------------------------------------------------------------------------
scatterDataA = np.random.normal(5.0,1.0, 1000)
scatterDataB = np.random.normal(10.0,2.0,1000)


# -------------------------------------------------------------------------------
# LINEAR REGRESSION
# -------------------------------------------------------------------------------
linearDataX = np.random.normal(5.0,1.0,1000)
linearDataY = np.random.uniform(0.0,10.0, 1000) * np.random.normal(5.0,1.0,1000) + linearDataX * 10.0 + np.random.normal(0.0,2.0,1000)

slope, intercept, r, p, std_err = stats.linregress(linearDataX, linearDataY)

def myfunc(x):
  return slope * x + intercept

mymodel = list(map(myfunc, linearDataX))

def printRelation():
    if r >= 0.5:
        print("The relationship of the two values is ", r, " meaning they do coorelate.")
    elif r<= 0.5:
        print("The relationship of the two values is ", r, " meaning they do not coorelate.")


# -------------------------------------------------------------------------------
# POLYNOMIAL REGRESSION
# -------------------------------------------------------------------------------
polyDataX = np.random.normal(5.0,1.0,1000)
polyDataY = np.random.uniform(0.0,10.0, 1000) * np.random.normal(5.0,1.0,1000) + polyDataX ** 3 + np.random.normal(0.0,2.0,1000)
polyModel = np.poly1d(np.polyfit(polyDataX, polyDataY, 3))
polyLine = np.linspace(np.min(polyDataX), np.max(polyDataX), 100)


# -------------------------------------------------------------------------------
# PLOTTING
# -------------------------------------------------------------------------------
fig, (ax1, ax2, ax3, ax4) = plt.subplots(1, 4, figsize=(24, 5))

def createPlot(axe, plot_type, data1, data2=None, bins=50):
    if plot_type == "hist":
        axe.hist(data1, bins=bins, color="steelblue", edgecolor="black")
    elif plot_type == "scatter":
        axe.scatter(data1, data2, alpha=0.5, color="darkorange")
    elif plot_type == "linear":
        axe.scatter(data1, data2, alpha=0.5, color="darkorange")
        axe.plot(data1, mymodel)
    elif plot_type == "poly":
        axe.scatter(data1, data2, alpha=0.5, color="darkorange")
        axe.plot(polyLine, polyModel(polyLine))
        
    axe.set_title(input("What should the title be?: "))
    axe.set_xlabel(input("What is the x axis name?: "))
    axe.set_ylabel(input("What is the y axis named?: "))

# ax1
# Call the function for the histogram on ax1
print("\n--- Configure Histogram ---")
createPlot(ax1, "hist", hisData, bins=50)

# ax2
# Call the function for the scatter plot on ax2
print("\n--- Configure Scatter Plot ---")
createPlot(ax2, "scatter", scatterDataA, scatterDataB)

# ax3
# Call the function for the linear regression plot on ax3
print("\n--- Configure Linear Regression Plot ---")
createPlot(ax3, "linear", linearDataX, linearDataY)

# ax4
# Call the function for the polynomial regression plot on ax4
print("\n--- Configure Polynomial Regression Plot ---")
createPlot(ax4, "poly", polyDataX, polyDataY)

printRelation()
plt.tight_layout()
plt.show()